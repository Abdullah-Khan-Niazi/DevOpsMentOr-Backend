import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config';
import { registerRoutes } from './routes';
import { requestLogger } from './middleware/request-logger.middleware';
import { swaggerSpec } from '../docs/swagger';
import { HTTP_STATUS } from '../shared/constants';
import { errorMiddleware, notFoundMiddleware } from '../shared/middleware';
import { sendSuccess } from '../shared/utils';
import { UPLOAD_DIR } from '../features/users/services/upload.service';
import { systemTelemetryService } from '../shared/services/system-telemetry.service';

/** Upload extensions served inline; everything else is forced to download. */
const INLINE_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

/**
 * API responses are JSON only: nothing may be framed, scripted, styled or
 * submitted from them. `same-site` CORP lets the Vite/SPA origin on the same
 * site read API resources; `/uploads` overrides it to `cross-origin` below.
 */
const apiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
});

/** swagger-ui needs its own same-origin scripts, styles (inline theme) and images. */
const docsHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
});

export function createApp() {
  const app = express();

  // An explicit allowlist is required: a wildcard would let any site drive the
  // API from a victim's browser (and is meaningless next to the origin list).
  if (env.CORS_ORIGIN.trim() === '*') {
    throw new Error(
      "CORS_ORIGIN='*' is not allowed. Configure an explicit origin list.",
    );
  }
  const corsOrigins = env.CORS_ORIGIN.split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGIN must list at least one explicit origin and no wildcard.');
  }

  app.disable('x-powered-by');

  // Behind a reverse proxy, req.ip must resolve the real client address so
  // rate limiting keys on the caller, not the load balancer.
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  // `/api-docs` gets its own CSP; every other path gets the strict API policy.
  app.use((req, res, next) => {
    if (req.path === '/api-docs' || req.path.startsWith('/api-docs/')) {
      docsHelmet(req, res, next);
      return;
    }
    apiHelmet(req, res, next);
  });
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=()');
    next();
  });
  app.use(
    cors({
      origin: corsOrigins,
      // Bearer tokens travel in the Authorization header; the refresh and logout
      // endpoints also read the httpOnly refresh cookie, so credentialed CORS is
      // on for the configured origins only (never a wildcard).
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      // X-CSRF-Token is the double-submit header checked by requireCsrf.
      allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
      // Neither header is CORS-safelisted: the SPA reads Retry-After on 429s
      // and Date to derive the server clock offset for quiz timers.
      exposedHeaders: ['Retry-After', 'Date'],
      maxAge: 600,
    }),
  );
  app.use(`${env.API_PREFIX}/billing/webhooks/stripe`, express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  // Uploaded images are embedded by the SPA origin (D24: helmet's default
  // same-origin CORP blocked them). Never sniff; anything that is not one of
  // the known image types downloads instead of rendering in the API origin.
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      dotfiles: 'deny',
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        if (!INLINE_UPLOAD_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
          res.setHeader('Content-Disposition', 'attachment');
        }
      },
    }),
  );
  app.use(requestLogger);
  app.use((_req, _res, next) => {
    systemTelemetryService.recordRequest();
    next();
  });

  // ─── Open Keep-Alive & Health Check Endpoints ──────────────────────────────
  // Can be pinged by external cron jobs (e.g., cron-job.org, UptimeRobot, BetterUptime)
  // to keep the server awake and prevent platform sleeping / cold starts.
  const healthHandler = (_req: express.Request, res: express.Response) => {
    sendSuccess(
      res,
      {
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
      },
      'Service is healthy.',
    );
  };

  const pingHandler = (_req: express.Request, res: express.Response) => {
    res.status(HTTP_STATUS.OK).json({ status: 'ok', message: 'pong' });
  };

  // Root endpoint: prevents 404 when cron pings the base domain
  app.get('/', (_req, res) => {
    sendSuccess(
      res,
      {
        name: env.APP_NAME,
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
      },
      `${env.APP_NAME} API is running.`,
    );
  });

  // Dedicated health check endpoints (support root and prefixed paths)
  app.get('/health', healthHandler);
  app.get(`${env.API_PREFIX}/health`, healthHandler);

  // Ultra-lightweight ping-pong endpoints
  app.get('/ping', pingHandler);
  app.get(`${env.API_PREFIX}/ping`, pingHandler);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });

  app.use(env.API_PREFIX, registerRoutes());

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
