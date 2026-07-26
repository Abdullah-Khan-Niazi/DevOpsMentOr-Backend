import { createApp } from './app';
import { env } from './config';
import { logger } from '../shared/logger';

export async function startServer(): Promise<void> {
  // Database connection temporarily disabled until PostgreSQL is configured.
  // Re-enable: await connectDatabase() from './database'

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`API base path: ${env.API_PREFIX}`);
    logger.info(`Swagger docs: http://localhost:${env.PORT}/api-docs`);
    logger.warn('Database connection is disabled. DB-backed routes will fail until it is re-enabled.');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}
