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

const CSRF_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

function resolveCookiePolicy(): {
  domain: string | undefined;
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
} {
  const sameSite = env.AUTH_COOKIE_SAME_SITE ?? 'strict';
  return {
    domain: env.AUTH_COOKIE_DOMAIN || undefined,
    sameSite,
    secure: sameSite === 'none' ? true : env.AUTH_COOKIE_SECURE,
  };
}

/**
 * Ensures a readable CSRF double-submit cookie exists and returns the current token
 * in both the return value and the `X-CSRF-Token` response header (so cross-origin SPAs
 * that cannot read cross-site `document.cookie` still receive it).
 */
export function ensureCsrfCookie(req: Request, res: Response): string {
  const existing = readCookie(req, AUTH_COOKIES.csrf);
  if (existing && CSRF_TOKEN_RE.test(existing)) {
    res.setHeader?.('X-CSRF-Token', existing);
    return existing;
  }

  const { domain, sameSite, secure } = resolveCookiePolicy();
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  res.cookie(AUTH_COOKIES.csrf, csrfToken, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    expires: new Date(Date.now() + 7 * 86_400_000),
    domain,
  });
  res.setHeader?.('X-CSRF-Token', csrfToken);
  return csrfToken;
}

/**
 * Sets the refresh cookie (httpOnly, scoped to the auth path) and the CSRF
 * double-submit cookie (readable by the SPA). Returns the new CSRF value.
 */
export function setAuthCookies(
  res: Response,
  tokens: { refreshToken: string; refreshExpiresAt: Date },
): string {
  const { domain, sameSite, secure } = resolveCookiePolicy();
  const csrfToken = crypto.randomBytes(32).toString('base64url');

  res.cookie(AUTH_COOKIES.refresh, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: `${env.API_PREFIX}/auth`,
    expires: tokens.refreshExpiresAt,
    domain,
  });

  res.cookie(AUTH_COOKIES.csrf, csrfToken, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    expires: tokens.refreshExpiresAt,
    domain,
  });

  res.setHeader?.('X-CSRF-Token', csrfToken);
  return csrfToken;
}

/** Clears both auth cookies using the same path and domain they were set with. */
export function clearAuthCookies(res: Response): void {
  const { domain, sameSite, secure } = resolveCookiePolicy();

  res.clearCookie(AUTH_COOKIES.refresh, {
    httpOnly: true,
    secure,
    sameSite,
    path: `${env.API_PREFIX}/auth`,
    domain,
  });

  res.clearCookie(AUTH_COOKIES.csrf, {
    httpOnly: false,
    secure,
    sameSite,
    path: '/',
    domain,
  });
}
