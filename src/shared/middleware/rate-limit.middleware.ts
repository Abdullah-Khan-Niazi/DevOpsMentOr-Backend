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
}

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Counters are atomic INCR + EXPIRE pairs; failures are logged and let the
 * request through (fail-open) so the auth surface never bricks on a Redis
 * outage while still being protected in normal operation.
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

      logger.warn({ err }, 'Rate limiter unavailable; allowing request');
      next();
    }
  };
}