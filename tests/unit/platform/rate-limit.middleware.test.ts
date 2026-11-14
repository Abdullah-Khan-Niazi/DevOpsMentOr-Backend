import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../src/shared/errors';
import { HTTP_STATUS } from '../../../src/shared/constants';

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: { incr: redisMock.incr, expire: redisMock.expire },
  cacheKeys: {
    rateLimit: (scope: string, identifier: string) => `rate:${scope}:${identifier}`,
  },
}));

import { rateLimit } from '../../../src/shared/middleware/rate-limit.middleware';

const req = { ip: '203.0.113.5' } as Request;
const res = {} as Response;

describe('rateLimit middleware', () => {
  beforeEach(() => {
    redisMock.incr.mockReset();
    redisMock.expire.mockReset();
  });

  it('fails closed with 503 when Redis errors on a failClosed scope', async () => {
    redisMock.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const next = vi.fn() as unknown as NextFunction;

    const handler = rateLimit({
      scope: 'login',
      windowSeconds: 60,
      max: 10,
      failClosed: true,
    });
    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = vi.mocked(next).mock.calls[0][0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(error.message).toContain('temporarily unavailable');
  });

  it('stays fail-open on non-credential scopes so only auth bricks on a Redis outage', async () => {
    redisMock.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const next = vi.fn() as unknown as NextFunction;

    const handler = rateLimit({ scope: 'community-reviews', windowSeconds: 60, max: 10 });
    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('enforces the window cap with 429 when the counter exceeds max', async () => {
    redisMock.incr.mockResolvedValueOnce(11);
    const next = vi.fn() as unknown as NextFunction;

    const handler = rateLimit({
      scope: 'login',
      windowSeconds: 60,
      max: 10,
      failClosed: true,
    });
    await handler(req, res, next);

    const error = vi.mocked(next).mock.calls[0][0] as AppError;
    expect(error.statusCode).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('sets the window TTL on the first hit and lets the request through', async () => {
    redisMock.incr.mockResolvedValueOnce(1);
    redisMock.expire.mockResolvedValueOnce(1);
    const next = vi.fn() as unknown as NextFunction;

    const handler = rateLimit({
      scope: 'login',
      windowSeconds: 60,
      max: 10,
      failClosed: true,
    });
    await handler(req, res, next);

    expect(redisMock.expire).toHaveBeenCalledWith('rate:login:203.0.113.5', 60);
    expect(next).toHaveBeenCalledWith();
  });
});
