import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config';
import { registerRoutes } from './routes';
import { requestLogger } from './middleware/request-logger.middleware';
import { swaggerSpec } from '../docs/swagger';
import { errorMiddleware, notFoundMiddleware } from '../shared/middleware';
import { sendSuccess } from '../shared/utils';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((v) => v.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.get('/health', (_req, res) => {
    sendSuccess(res, { status: 'ok', environment: env.NODE_ENV }, 'Service is healthy.');
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });

  app.use(env.API_PREFIX, registerRoutes());

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
