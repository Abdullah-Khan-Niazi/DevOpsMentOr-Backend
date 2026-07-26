import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, refreshTokens } from '../../../app/database';
import { createId } from '../../../shared/utils';

export interface IRefreshTokenRepository {
  create(data: { token: string; userId: string; expiresAt: Date }): Promise<void>;
  findValidByToken(token: string): Promise<{ id: string; userId: string } | null>;
  revoke(token: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { token: string; userId: string; expiresAt: Date }): Promise<void> {
    await db.insert(refreshTokens).values({
      id: createId(),
      token: data.token,
      userId: data.userId,
      expiresAt: data.expiresAt,
    });
  }

  async findValidByToken(token: string): Promise<{ id: string; userId: string } | null> {
    const record = await db.query.refreshTokens.findFirst({
      where: and(
        eq(refreshTokens.token, token),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
      columns: { id: true, userId: true },
    });
    return record ?? null;
  }

  async revoke(token: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.token, token), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
