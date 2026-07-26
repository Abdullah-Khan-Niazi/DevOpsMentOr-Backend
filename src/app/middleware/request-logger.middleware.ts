import pinoHttp from 'pino-http';
import { logger } from '../../shared/logger';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/api-docs',
  },
});
