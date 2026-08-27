import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, sessions } from '../../app/database';
import { cacheKeys, redisClient } from '../../app/cache/redis';
import { UnauthorizedError } from '../errors';
import { tokenService } from '../services/token.service';

/**
 * Session identity middleware (attachSession).
 *
 * Decodes the access JWT, rejects blacklisted JTIs from Redis, and verifies
 * the session row in `sessions` is still active. Roles and permissions travel
 * inside the JWT (minted at login/refresh from the DB role chain) and are
 * re-verified by the route guards. Identity is NEVER taken from client
 * headers or request bodies.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Access token is required.');
    }

    const token = authHeader.slice(7);
    const payload = tokenService.verifyAccessToken(token);

    if (payload.jti && (await redisClient.get(cacheKeys.jtiBlacklist(payload.jti)))) {
      throw new UnauthorizedError('Invalid or expired access token.');
    }

    if (payload.jti) {
      const row = await db
        .select({ isActive: sessions.isActive, userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.sessionToken, payload.jti))
        .limit(1);

      if (row.length === 0 || !row[0].isActive) {
        throw new UnauthorizedError('Invalid or expired access token.');
      }

      if (Number(row[0].userId) !== Number(payload.sub)) {
        throw new UnauthorizedError('Invalid or expired access token.');
      }
    }

    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}