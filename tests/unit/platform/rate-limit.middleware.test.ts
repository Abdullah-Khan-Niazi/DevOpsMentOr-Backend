import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError, ERROR_CODES } from '../../../src/shared/errors';
import { HTTP_STATUS } from '../../../src/shared/constants';

type ExecResult = Array<[Error | null, unknown]> | null;

const redisMock = vi.hoisted(() => {
  const state = {
    exec: vi.fn<() => Promise<ExecResult>>(),
    expire: vi.fn(),
    calls: [] as Array<[string, ...unknown[]]>,
  };
  const chain = {
    set: (...args: unknown[]) => {
      state.calls.push(['set', ...args]);
      return chain;
    },
    incr: (...args: unknown[]) => {
      state.calls.push(['incr', ...args]);
      return chain;
    },
    ttl: (...args: unknown[]) => {
      state.calls.push(['ttl', ...args]);
      return chain;
    },
    exec: () => state.exec(),
  };
  return { state, multi: vi.fn(() => chain) };
});

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: { multi: redisMock.multi, expire: redisMock.state.expire },
  cacheKeys: {
    rateLimit: (scope: string, identifier: string) => `rate:${scope}:${identifier}`,
  },
}));

import { rateLimit } from '../../../src/shared/middleware/rate-limit.middleware';

const res = {} as Response;

function ipRequest(): Request {
  return { ip: '203.0.113.5' } as Request;
}

function userRequest(sub: string | undefined): Request {
  return { ip: '203.0.113.5', user: sub === undefined ? undefined : { sub } } as unknown as Request;
}

function counterResult(count: number, ttl: number): ExecResult {
  return [
    [null, 'OK'],
    [null, count],
    [null, ttl],
  ];
}

function errorFrom(next: NextFunction): AppError {
  return vi.mocked(next).mock.calls[0][0] as unknown as AppError;
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    redisMock.state.exec.mockReset();
    redisMock.state.expire.mockReset();
    redisMock.state.calls = [];
  });

  it('fails closed with 503 when Redis errors on a failClosed scope', async () => {
    redisMock.state.exec.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'login', windowSeconds: 60, max: 10, failClosed: true })(ipRequest(), res, next);

    const error = errorFrom(next);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(error.message).toContain('temporarily unavailable');
    expect(error.errors[0]).toEqual({ code: ERROR_CODES.RATE_LIMIT_UNAVAILABLE });
  });

  it('fails closed when a command inside the transaction errors', async () => {
    redisMock.state.exec.mockResolvedValueOnce([
      [null, 'OK'],
      [new Error('WRONGTYPE'), null],
      [null, 60],
    ]);
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'lab-check', windowSeconds: 60, max: 10, failClosed: true })(ipRequest(), res, next);

    expect(errorFrom(next).statusCode).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
  });

  it('stays fail-open on non-credential scopes', async () => {
    redisMock.state.exec.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'community-reviews', windowSeconds: 60, max: 10 })(ipRequest(), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('creates the counter with its TTL atomically (SET NX EX, INCR, TTL in one MULTI)', async () => {
    redisMock.state.exec.mockResolvedValueOnce(counterResult(1, 60));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'login', windowSeconds: 60, max: 10 })(ipRequest(), res, next);

    expect(redisMock.multi).toHaveBeenCalled();
    expect(redisMock.state.calls).toEqual([
      ['set', 'rate:login:ip:203.0.113.5', '0', 'EX', 60, 'NX'],
      ['incr', 'rate:login:ip:203.0.113.5'],
      ['ttl', 'rate:login:ip:203.0.113.5'],
    ]);
    expect(redisMock.state.expire).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('repairs a counter left without a TTL', async () => {
    redisMock.state.exec.mockResolvedValueOnce(counterResult(3, -1));
    redisMock.state.expire.mockResolvedValueOnce(1);
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'login', windowSeconds: 60, max: 10 })(ipRequest(), res, next);

    expect(redisMock.state.expire).toHaveBeenCalledWith('rate:login:ip:203.0.113.5', 60);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with 429, RATE_LIMITED and retryAfterSeconds = remaining TTL', async () => {
    redisMock.state.exec.mockResolvedValueOnce(counterResult(11, 42));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'login', windowSeconds: 60, max: 10, failClosed: true })(ipRequest(), res, next);

    const error = errorFrom(next);
    expect(error.statusCode).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(error.errors[0]).toEqual({ code: ERROR_CODES.RATE_LIMITED, retryAfterSeconds: 42 });
  });

  it('keys on the session user when keyBy is user', async () => {
    redisMock.state.exec.mockResolvedValueOnce(counterResult(1, 60));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'lab-check', windowSeconds: 60, max: 10, keyBy: 'user' })(userRequest('17'), res, next);

    expect(redisMock.state.calls[1]).toEqual(['incr', 'rate:lab-check:u:17']);
  });

  it('falls back to the IP key when keyBy is user but no session is present', async () => {
    redisMock.state.exec.mockResolvedValueOnce(counterResult(1, 60));
    const next = vi.fn() as unknown as NextFunction;

    await rateLimit({ scope: 'lab-check', windowSeconds: 60, max: 10, keyBy: 'user' })(
      userRequest(undefined),
      res,
      next,
    );

    expect(redisMock.state.calls[1]).toEqual(['incr', 'rate:lab-check:ip:203.0.113.5']);
  });

  it('gives different users behind one IP separate budgets', async () => {
    redisMock.state.exec.mockResolvedValue(counterResult(1, 60));
    const limiter = rateLimit({ scope: 'quiz-answer', windowSeconds: 60, max: 1, keyBy: 'user' });

    await limiter(userRequest('1'), res, vi.fn() as unknown as NextFunction);
    await limiter(userRequest('2'), res, vi.fn() as unknown as NextFunction);

    const keys = redisMock.state.calls.filter(([op]) => op === 'incr').map(([, key]) => key);
    expect(keys).toEqual(['rate:quiz-answer:u:1', 'rate:quiz-answer:u:2']);
  });
});
