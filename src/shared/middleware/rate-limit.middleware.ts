import type { NextFunction, Request, Response } from 'express';
import { redisClient } from '../../app/cache/redis';
import { cacheKeys } from '../../app/cache/redis';
import { HTTP_STATUS } from '../constants';
import { AppError } from '../errors';
import { logger } from '../logger';

interface RateLimitOptions {
  windowSeconds: number;
  max: number;
  /** Scope prefix used in the Redis key. */
  scope: string;
  /**
   * When true, a Redis outage rejects the request with 503 instead of letting
   * it through. Required for credential surfaces, where failing open would
   * disable brute-force protection exactly when the cache is degraded.
   */
  failClosed?: boolean;
}

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Counters are atomic INCR + EXPIRE pairs. By default failures are logged and
 * let the request through (fail-open) so non-credential surfaces never brick
 * on a Redis outage; credential routes opt into `failClosed`.
 */
export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const identifier = req.ip ?? 'unknown';

    try {
      const key = cacheKeys.rateLimit(options.scope, identifier);
      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, options.windowSeconds);
      }

      if (current > options.max) {
        throw new AppError(
          'Too many requests. Please try again later.',
          HTTP_STATUS.TOO_MANY_REQUESTS,
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
          ),
        );
        return;
      }

      logger.warn({ err }, 'Rate limiter unavailable; allowing request');
      next();
    }
  };
}
