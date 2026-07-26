import { startServer } from './app/server';
import { logger } from './shared/logger';

void startServer().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
