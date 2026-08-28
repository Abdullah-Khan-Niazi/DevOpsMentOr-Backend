import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';

dotenv.config();

// Aiven requires TLS. mysql2 ignores the `ssl-mode` query param, and Drizzle
// Kit would otherwise pass it as an invalid connection option and connect
// without SSL (Aiven rejects that). Strip it and enable TLS explicitly.
const dbUrl = new URL(process.env.DATABASE_URL ?? '');
const sslMode = dbUrl.searchParams.get('ssl-mode');
const useSsl = sslMode !== null && sslMode.toUpperCase() !== 'DISABLED';
dbUrl.searchParams.delete('ssl-mode');

const rawCa = process.env.DB_SSL_CA;
const ca =
  rawCa && rawCa.includes('-----BEGIN CERTIFICATE-----')
    ? rawCa
    : rawCa
      ? readFileSync(rawCa, 'utf8')
      : undefined;

export default defineConfig({
  schema: './src/app/database/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: dbUrl.hostname,
    port: dbUrl.port ? Number(dbUrl.port) : 3306,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, ''),
    ssl: useSsl ? (ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false }) : undefined,
  },
});