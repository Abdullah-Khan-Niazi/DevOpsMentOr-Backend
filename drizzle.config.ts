import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
let credentials: any = { url: rawUrl };

if (rawUrl) {
  let dbUrl: URL | null = null;
  try {
    dbUrl = new URL(rawUrl);
  } catch {
    dbUrl = null;
  }

  if (dbUrl) {
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

    if (useSsl && !ca) {
      // Mirror the runtime pool: never disable certificate verification.
      throw new Error(
        'DATABASE_URL enables ssl-mode but DB_SSL_CA is not configured. Provide the CA certificate ' +
          '(PEM contents or a file path) so the database TLS connection can be verified.',
      );
    }

    credentials = {
      host: dbUrl.hostname,
      port: dbUrl.port ? Number(dbUrl.port) : 3306,
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      database: dbUrl.pathname.replace(/^\//, ''),
      ssl: useSsl ? { rejectUnauthorized: true, ca } : undefined,
    };
  }
}

export default defineConfig({
  schema: './src/app/database/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: credentials,
});
