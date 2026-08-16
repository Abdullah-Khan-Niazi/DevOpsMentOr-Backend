import { createApp } from './app';
import { env } from './config';
import { logger } from '../shared/logger';
import { connectDatabase, disconnectDatabase } from './database';
import { connectRedis, disconnectRedis } from './cache/redis';
import { labTtlMonitorJob } from '../features/labs';

export async function startServer(): Promise<void> {
  await connectDatabase();
  await connectRedis();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`API base path: ${env.API_PREFIX}`);
    logger.info(`Swagger docs: http://localhost:${env.PORT}/api-docs`);
  });

  labTtlMonitorJob.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    labTtlMonitorJob.stop();
    server.close(() => {
      void (async () => {
        await disconnectRedis();
        await disconnectDatabase();
        process.exit(0);
      })();
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}