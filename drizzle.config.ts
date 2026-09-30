import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
let credentials: any = { url: rawUrl };

if (rawUrl) {
  try {
    const dbUrl = new URL(rawUrl);
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

    credentials = {
      host: dbUrl.hostname,
      port: dbUrl.port ? Number(dbUrl.port) : 3306,
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      database: dbUrl.pathname.replace(/^\//, ''),
      ssl: useSsl ? (ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false }) : undefined,
    };
  } catch {
    credentials = { url: rawUrl };
  }
}

export default defineConfig({
  schema: './src/app/database/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: credentials,
});