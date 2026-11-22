import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../../app/config/env';

/** Cookie names used by the auth session flow (contracts 11.5). */
export const AUTH_COOKIES = {
  refresh: 'dm_rt',
  csrf: 'dm_csrf',
} as const;

/**
 * Parses a `Cookie` request header into a name -> value map. Pairs without `=`
 * or with an undecodable value are skipped instead of failing the request.
 * The map has no prototype, so a cookie named `__proto__` is plain data.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return cookies;

  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const name = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding: ignore this cookie only.
    }
  }
  return cookies;
}

/** Reads one cookie from the request, or `undefined` when it is absent. */
export function readCookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

/**
 * Sets the refresh cookie (httpOnly, scoped to the auth path) and the CSRF
 * double-submit cookie (readable by the SPA). Returns the new CSRF value.
 */
export function setAuthCookies(
  res: Response,
  tokens: { refreshToken: string; refreshExpiresAt: Date },
): string {
  const domain = env.AUTH_COOKIE_DOMAIN || undefined;
  const csrfToken = crypto.randomBytes(32).toString('base64url');

  res.cookie(AUTH_COOKIES.refresh, tokens.refreshToken, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: 'strict',
    path: `${env.API_PREFIX}/auth`,
    expires: tokens.refreshExpiresAt,
    domain,
  });

  res.cookie(AUTH_COOKIES.csrf, csrfToken, {
    httpOnly: false,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: tokens.refreshExpiresAt,
    domain,
  });

  return csrfToken;
}

/** Clears both auth cookies using the same path and domain they were set with. */
export function clearAuthCookies(res: Response): void {
  const domain = env.AUTH_COOKIE_DOMAIN || undefined;

  res.clearCookie(AUTH_COOKIES.refresh, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: 'strict',
    path: `${env.API_PREFIX}/auth`,
    domain,
  });

  res.clearCookie(AUTH_COOKIES.csrf, {
    httpOnly: false,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    domain,
  });
}
