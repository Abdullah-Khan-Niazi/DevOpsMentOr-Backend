import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { env } from '../config';
import { logger } from '../../shared/logger';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  pool?: mysql.Pool;
};

// Aiven/MySQL often require TLS. mysql2 ignores the `ssl-mode` query param in
// the URI, so enable SSL explicitly and, when a CA is provided, verify it.
const dbUrl = new URL(env.DATABASE_URL);
const sslMode = dbUrl.searchParams.get('ssl-mode');
const useSsl = sslMode !== null && sslMode.toUpperCase() !== 'DISABLED';
dbUrl.searchParams.delete('ssl-mode');

const poolConfig: mysql.PoolOptions = { uri: dbUrl.toString() };
if (useSsl) {
  const rawCa = env.DB_SSL_CA;
  const ca =
    rawCa && rawCa.includes('-----BEGIN CERTIFICATE-----')
      ? rawCa
      : rawCa
        ? readFileSync(rawCa, 'utf8')
        : undefined;
  poolConfig.ssl = ca
    ? { rejectUnauthorized: true, ca }
    : { rejectUnauthorized: false };
  if (!ca) {
    logger.warn('Database SSL enabled with rejectUnauthorized=false (no DB_SSL_CA provided).');
  }
}

export const pool =
  globalForDb.pool ?? mysql.createPool(poolConfig);

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
