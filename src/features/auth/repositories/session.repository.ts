import { and, eq, gt } from 'drizzle-orm';
import { db, sessions } from '../../../app/database';

export interface ActiveSessionRecord {
  sessionId: number;
  userId: number;
  sessionToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export interface ISessionRepository {
  create(data: {
    userId: number;
    sessionToken: string;
    refreshToken: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void>;
  findActiveByRefreshToken(token: string): Promise<ActiveSessionRecord | null>;
  rotate(
    refreshToken: string,
    data: { sessionToken: string; newRefreshToken: string; expiresAt: Date },
  ): Promise<void>;
  deactivateByRefreshToken(token: string): Promise<void>;
  deactivateAllForUser(userId: number): Promise<void>;
}

export class SessionRepository implements ISessionRepository {
  async create(data: {
    userId: number;
    sessionToken: string;
    refreshToken: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await db.insert(sessions).values({
      userId: data.userId,
      sessionToken: data.sessionToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      isActive: true,
    });
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
  ): Promise<void> {
    await db
      .update(sessions)
      .set({
        sessionToken: data.sessionToken,
        refreshToken: data.newRefreshToken,
        expiresAt: data.expiresAt,
        lastActivityAt: new Date(),
      })
      .where(eq(sessions.refreshToken, refreshToken));
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
}

export const sessionRepository = new SessionRepository();