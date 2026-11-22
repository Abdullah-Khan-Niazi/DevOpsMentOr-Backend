import type { NextFunction, Request, Response } from 'express';
import { redisClient } from '../../app/cache/redis';
import { cacheKeys } from '../../app/cache/redis';
import { HTTP_STATUS } from '../constants';
import { AppError, ERROR_CODES } from '../errors';
import { logger } from '../logger';

interface RateLimitOptions {
  windowSeconds: number;
  max: number;
  /** Scope prefix used in the Redis key. */
  scope: string;
  /**
   * When true, a Redis outage rejects the request with 503 instead of letting
   * it through. Required for credential surfaces and for every learner write
   * that grants or costs points (lab check/hint, quiz submit), where failing
   * open would disable the protection exactly when the cache is degraded.
   */
  failClosed?: boolean;
  /**
   * Budget owner. `'ip'` (default) keys on the client address; `'user'` keys
   * on the authenticated session subject so NAT'd learners do not share one
   * budget. `'user'` routes MUST mount the limiter after `authenticate`; when
   * no session is present the limiter falls back to the IP key.
   */
  keyBy?: 'ip' | 'user';
}

/** Builds the counter identifier: `u:{userId}` or `ip:{ip}`. */
function resolveIdentifier(req: Request, keyBy: 'ip' | 'user'): string {
  if (keyBy === 'user') {
    const sub = req.user?.sub;
    if (typeof sub === 'string' && /^\d+$/.test(sub)) {
      return `u:${sub}`;
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Atomically counts one hit in a fixed window and returns `{ count, ttl }`.
 *
 * `SET key 0 EX window NX` creates the counter WITH its TTL in one command
 * (no-op when the window is already open), `INCR` keeps that TTL, and `TTL`
 * reports the remaining window. All three run in one MULTI, so a crash can
 * never leave a counter without an expiry (D26). A key that still has no TTL
 * (written by the previous INCR-then-EXPIRE implementation) is repaired.
 */
async function hit(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
  const results = await redisClient
    .multi()
    .set(key, '0', 'EX', windowSeconds, 'NX')
    .incr(key)
    .ttl(key)
    .exec();

  if (!results) {
    throw new Error('Rate limiter transaction was aborted.');
  }
  for (const [err] of results) {
    if (err) throw err;
  }

  const count = Number(results[1]?.[1]);
  let ttl = Number(results[2]?.[1]);
  if (!Number.isFinite(count)) {
    throw new Error('Rate limiter returned a non-numeric counter.');
  }
  if (!Number.isFinite(ttl) || ttl < 0) {
    await redisClient.expire(key, windowSeconds);
    ttl = windowSeconds;
  }
  return { count, ttl };
}

/**
 * Redis-backed fixed-window rate limiter.
 *
 * By default Redis failures are logged and let the request through
 * (fail-open) so non-credential surfaces never brick on a Redis outage;
 * credential and point-bearing routes opt into `failClosed`. A rejected
 * request gets 429 with `[{ code: 'RATE_LIMITED', retryAfterSeconds }]`,
 * which the error middleware mirrors into the `Retry-After` header.
 */
export function rateLimit(options: RateLimitOptions) {
  const keyBy = options.keyBy ?? 'ip';

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const identifier = resolveIdentifier(req, keyBy);

    try {
      const key = cacheKeys.rateLimit(options.scope, identifier);
      const { count, ttl } = await hit(key, options.windowSeconds);

      if (count > options.max) {
        throw new AppError(
          'Too many requests. Please try again later.',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          [{ code: ERROR_CODES.RATE_LIMITED, retryAfterSeconds: Math.max(1, ttl) }],
        );
      }

      next();
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }

      if (options.failClosed) {
        logger.error({ err, scope: options.scope }, 'Rate limiter unavailable; failing closed');
        next(
          new AppError(
            'Request protection is temporarily unavailable. Please try again shortly.',
            HTTP_STATUS.SERVICE_UNAVAILABLE,
            [{ code: ERROR_CODES.RATE_LIMIT_UNAVAILABLE }],
          ),
        );
        return;
      }

      logger.warn({ err, scope: options.scope }, 'Rate limiter unavailable; allowing request');
      next();
    }
  };
}
