import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from '../config';
import { logger } from '../../shared/logger';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  pool?: mysql.Pool;
};

export const pool =
  globalForDb.pool ??
  mysql.createPool({
    uri: env.DATABASE_URL,
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema,mode:'default' });

export async function connectDatabase(): Promise<void> {
  const client = await pool.getConnection();
  client.release();
  logger.info('Database connected.');
}

export async function disconnectDatabase(): Promise<void> {
  await pool.end();
  logger.info('Database disconnected.');
}
