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

export function createApp() {
  const app = express();

  // Credentialed CORS (`credentials: true`) makes a wildcard origin unsafe:
  // browsers would accept authenticated cross-site requests from any site.
  if (env.CORS_ORIGIN.trim() === '*') {
    throw new Error(
      "CORS_ORIGIN='*' is not allowed while credentialed CORS is enabled. Configure an explicit origin list.",
    );
  }

  // Behind a reverse proxy, req.ip must resolve the real client address so
  // rate limiting keys on the caller, not the load balancer.
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((v) => v.trim()),
      credentials: true,
    }),
  );
  app.use(`${env.API_PREFIX}/billing/webhooks/stripe`, express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/uploads', express.static(UPLOAD_DIR));
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
