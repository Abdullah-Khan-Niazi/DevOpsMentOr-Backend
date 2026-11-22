import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError, ERROR_CODES } from '../../../src/shared/errors';
import { HTTP_STATUS } from '../../../src/shared/constants';

vi.mock('../../../src/app/config/env', () => ({
  env: {
    CORS_ORIGIN: 'http://localhost:5173, https://app.example.test',
    API_PREFIX: '/api/v1',
    AUTH_COOKIE_SECURE: false,
    AUTH_COOKIE_DOMAIN: '',
  },
}));

import { requireCsrf } from '../../../src/shared/middleware/csrf.middleware';

const TOKEN = 'a'.repeat(43);

function requestWith(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

const res = {} as Response;

function runCsrf(req: Request): NextFunction {
  const next = vi.fn() as unknown as NextFunction;
  requireCsrf(req, res, next);
  return next;
}

function errorFrom(next: NextFunction): AppError {
  return vi.mocked(next).mock.calls[0][0] as unknown as AppError;
}

describe('requireCsrf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a request without Origin or Referer with CSRF_REJECTED', () => {
    const next = runCsrf(
      requestWith({ 'x-csrf-token': TOKEN, cookie: `dm_csrf=${TOKEN}` }),
    );

    const error = errorFrom(next);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(error.errors).toEqual([{ code: ERROR_CODES.CSRF_REJECTED }]);
  });

  it('rejects an origin that is not in the CORS allowlist', () => {
    const next = runCsrf(
      requestWith({
        origin: 'https://evil.example.test',
        'x-csrf-token': TOKEN,
        cookie: `dm_csrf=${TOKEN}`,
      }),
    );

    const error = errorFrom(next);
    expect(error.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(error.message).toBe('Request origin not allowed.');
    expect(error.errors).toEqual([{ code: ERROR_CODES.CSRF_REJECTED }]);
  });

  it('passes an allowed origin with equal header and cookie tokens', () => {
    const next = runCsrf(
      requestWith({
        origin: 'http://localhost:5173',
        'x-csrf-token': TOKEN,
        cookie: `dm_rt=opaque; dm_csrf=${TOKEN}`,
      }),
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a mismatched header and cookie token', () => {
    const next = runCsrf(
      requestWith({
        origin: 'http://localhost:5173',
        'x-csrf-token': 'b'.repeat(43),
        cookie: `dm_csrf=${TOKEN}`,
      }),
    );

    const error = errorFrom(next);
    expect(error.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(error.message).toBe('CSRF token missing or invalid.');
    expect(error.errors).toEqual([{ code: ERROR_CODES.CSRF_REJECTED }]);
  });

  it('rejects when the CSRF cookie is missing', () => {
    const next = runCsrf(
      requestWith({ origin: 'http://localhost:5173', 'x-csrf-token': TOKEN }),
    );

    expect(errorFrom(next).errors).toEqual([{ code: ERROR_CODES.CSRF_REJECTED }]);
  });

  it('accepts the origin of Referer when Origin is absent', () => {
    const next = runCsrf(
      requestWith({
        referer: 'https://app.example.test/settings/security?tab=sessions',
        'x-csrf-token': TOKEN,
        cookie: `dm_csrf=${TOKEN}`,
      }),
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a malformed Referer when Origin is absent', () => {
    const next = runCsrf(
      requestWith({
        referer: 'not a url',
        'x-csrf-token': TOKEN,
        cookie: `dm_csrf=${TOKEN}`,
      }),
    );

    expect(errorFrom(next).errors).toEqual([{ code: ERROR_CODES.CSRF_REJECTED }]);
  });
});
