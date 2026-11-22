import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../app/config/env';
import { ERROR_CODES, ForbiddenError } from '../errors';
import { AUTH_COOKIES, readCookie } from '../utils/auth-cookies';

const CSRF_HEADER = 'x-csrf-token';

/** Origin of the request: the `Origin` header, else the origin of `Referer`. */
function resolveRequestOrigin(req: Request): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) return origin;

  const referer = req.headers.referer;
  if (typeof referer !== 'string' || referer.length === 0) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = env.CORS_ORIGIN.split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return allowed.includes(origin);
}

function timingSafeMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * CSRF guard for cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`,
 * `/auth/logout-all`). Two checks, both required:
 * 1. the request origin is one of the configured CORS origins;
 * 2. the `X-CSRF-Token` header equals the `dm_csrf` cookie (double submit).
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (!isAllowedOrigin(resolveRequestOrigin(req))) {
    next(new ForbiddenError('Request origin not allowed.', [{ code: ERROR_CODES.CSRF_REJECTED }]));
    return;
  }

  const headerRaw = req.headers[CSRF_HEADER];
  const headerToken = typeof headerRaw === 'string' ? headerRaw : undefined;
  const cookieToken = readCookie(req, AUTH_COOKIES.csrf);

  if (!headerToken || !cookieToken || !timingSafeMatch(headerToken, cookieToken)) {
    next(new ForbiddenError('CSRF token missing or invalid.', [{ code: ERROR_CODES.CSRF_REJECTED }]));
    return;
  }

  next();
}
