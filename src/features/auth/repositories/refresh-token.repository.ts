import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, refreshTokens } from '../../../app/database';

export interface IRefreshTokenRepository {
  create(data: { token: string; userId: number; expiresAt: Date }): Promise<void>;
  findValidByToken(token: string): Promise<{ id: number; userId: number } | null>;
  revoke(token: string): Promise<void>;
  revokeAllForUser(userId: number): Promise<void>;
}

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { token: string; userId: number; expiresAt: Date }): Promise<void> {
    await db.insert(refreshTokens).values({
      token: data.token,
      userId: data.userId,
      expiresAt: data.expiresAt,
    });
  }

  async findValidByToken(token: string): Promise<{ id: number; userId: number } | null> {
    const records = await db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.token, token),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return records[0] ?? null;
  }

  async revoke(token: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.token, token), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
