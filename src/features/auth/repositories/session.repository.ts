import { and, eq, gt } from 'drizzle-orm';
import { db, sessions } from '../../../app/database';
import { redisClient } from '../../../app/cache/redis';

export interface ActiveSessionRecord {
  sessionId: number;
  userId: number;
  sessionToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

/** Full session row used by refresh-reuse handling (active or not). */
export interface SessionRecord extends ActiveSessionRecord {
  isActive: boolean;
}

/** Redis key mapping a refresh JWT jti to the session that issued it (reuse detection). */
const refreshSessionKey = (refreshJti: string): string => `auth:rt_session:${refreshJti}`;

export interface ISessionRepository {
  create(data: {
    userId: number;
    sessionToken: string;
    refreshToken: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<number>;
  findById(sessionId: number): Promise<SessionRecord | null>;
  findActiveByRefreshToken(token: string): Promise<ActiveSessionRecord | null>;
  /** Compare-and-swap on the current refresh token of an active session; false when nothing was rotated. */
  rotate(
    refreshToken: string,
    data: { sessionToken: string; newRefreshToken: string; expiresAt: Date },
  ): Promise<boolean>;
  deactivateById(sessionId: number): Promise<void>;
  deactivateByRefreshToken(token: string): Promise<void>;
  deactivateAllForUser(userId: number): Promise<void>;
  saveRefreshSessionMapping(refreshJti: string, sessionId: number, ttlSeconds: number): Promise<void>;
  findSessionIdByRefreshJti(refreshJti: string): Promise<number | null>;
}

export class SessionRepository implements ISessionRepository {
  async create(data: {
    userId: number;
    sessionToken: string;
    refreshToken: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<number> {
    const [inserted] = await db.insert(sessions).values({
      userId: data.userId,
      sessionToken: data.sessionToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      isActive: true,
    });
    return inserted.insertId;
  }

  async findById(sessionId: number): Promise<SessionRecord | null> {
    const rows = await db
      .select({
        sessionId: sessions.sessionId,
        userId: sessions.userId,
        sessionToken: sessions.sessionToken,
        refreshToken: sessions.refreshToken,
        expiresAt: sessions.expiresAt,
        isActive: sessions.isActive,
      })
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findActiveByRefreshToken(token: string): Promise<ActiveSessionRecord | null> {
    const rows = await db
      .select({
        sessionId: sessions.sessionId,
        userId: sessions.userId,
        sessionToken: sessions.sessionToken,
        refreshToken: sessions.refreshToken,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.refreshToken, token),
          eq(sessions.isActive, true),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async rotate(
    refreshToken: string,
    data: { sessionToken: string; newRefreshToken: string; expiresAt: Date },
  ): Promise<boolean> {
    const [result] = await db
      .update(sessions)
      .set({
        sessionToken: data.sessionToken,
        refreshToken: data.newRefreshToken,
        expiresAt: data.expiresAt,
        lastActivityAt: new Date(),
      })
      .where(and(eq(sessions.refreshToken, refreshToken), eq(sessions.isActive, true)));
    return result.affectedRows > 0;
  }

  async deactivateById(sessionId: number): Promise<void> {
    await db
      .update(sessions)
      .set({ isActive: false })
      .where(eq(sessions.sessionId, sessionId));
  }

  async deactivateByRefreshToken(token: string): Promise<void> {
    await db
      .update(sessions)
      .set({ isActive: false })
      .where(eq(sessions.refreshToken, token));
  }

  async deactivateAllForUser(userId: number): Promise<void> {
    await db
      .update(sessions)
      .set({ isActive: false })
      .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)));
  }

  async saveRefreshSessionMapping(refreshJti: string, sessionId: number, ttlSeconds: number): Promise<void> {
    await redisClient.set(refreshSessionKey(refreshJti), String(sessionId), 'EX', ttlSeconds);
  }

  async findSessionIdByRefreshJti(refreshJti: string): Promise<number | null> {
    const value = await redisClient.get(refreshSessionKey(refreshJti));
    if (value === null) return null;
    const sessionId = Number(value);
    return Number.isInteger(sessionId) && sessionId > 0 ? sessionId : null;
  }
}

export const sessionRepository = new SessionRepository();
