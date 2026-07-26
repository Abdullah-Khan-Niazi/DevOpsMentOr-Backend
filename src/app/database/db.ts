import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config';
import { logger } from '../../shared/logger';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  pool?: Pool;
};

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema });

export async function connectDatabase(): Promise<void> {
  const client = await pool.connect();
  client.release();
  logger.info('Database connected.');
}

export async function disconnectDatabase(): Promise<void> {
  await pool.end();
  logger.info('Database disconnected.');
}
