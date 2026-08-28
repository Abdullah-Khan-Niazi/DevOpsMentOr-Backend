import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { apiTokens, db } from '../../../app/database';

export interface ApiTokenRecord {
  tokenId: number;
  userId: number;
  tokenName: string;
  apiToken: string;
  permissions: string[] | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

function toRecord(row: typeof apiTokens.$inferSelect): ApiTokenRecord {
  const permissions = Array.isArray(row.permissions)
    ? (row.permissions as unknown[]).map((p) => String(p))
    : null;

  return {
    tokenId: row.tokenId,
    userId: row.userId,
    tokenName: row.tokenName,
    apiToken: row.apiToken,
    permissions,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export interface IApiTokenRepository {
  create(data: {
    userId: number;
    tokenName: string;
    apiTokenHash: string;
    permissions: string[];
    expiresAt?: Date | null;
  }): Promise<number>;
  findActiveByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  listActiveForUser(userId: number): Promise<ApiTokenRecord[]>;
  revoke(userId: number, tokenId: number): Promise<boolean>;
}

export class ApiTokenRepository implements IApiTokenRepository {
  async create(data: {
    userId: number;
    tokenName: string;
    apiTokenHash: string;
    permissions: string[];
    expiresAt?: Date | null;
  }): Promise<number> {
    const inserted = await db.insert(apiTokens).values({
      userId: data.userId,
      tokenName: data.tokenName,
      apiToken: data.apiTokenHash,
      permissions: data.permissions,
      expiresAt: data.expiresAt ?? null,
      isActive: true,
    });

    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create API token.');
    }
    return id;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.apiToken, tokenHash),
          eq(apiTokens.isActive, true),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
        ),
      )
      .limit(1);

    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listActiveForUser(userId: number): Promise<ApiTokenRecord[]> {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.userId, userId),
          eq(apiTokens.isActive, true),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(apiTokens.createdAt));

    return rows.map((row) => toRecord(row));
  }

  async revoke(userId: number, tokenId: number): Promise<boolean> {
    const result = await db
      .update(apiTokens)
      .set({ isActive: false })
      .where(and(eq(apiTokens.userId, userId), eq(apiTokens.tokenId, tokenId)));

    return (result[0]?.affectedRows ?? 0) > 0;
  }
}

export const apiTokenRepository = new ApiTokenRepository();