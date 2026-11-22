import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import { pointsHistory, users } from '../../../app/database/schema';
import type { PointsSourceType } from '../dto/gamification.dto';
import { awardKeyPrefix, escapeLike } from '../config/award-keys';

/** Transaction handle (same alias as gamification.repository.ts). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface LedgerInsert {
  userId: number;
  pointsChange: number;
  pointsBalanceAfter: number;
  sourceType: PointsSourceType;
  sourceId: number | null;
  description: string;
}

/**
 * Low-level `points_history` access for the award routine. Every method
 * takes the caller's transaction: they run only inside
 * `awardService.withUserLock`, after the user row has been locked.
 */
export class LedgerRepository {
  /**
   * `SELECT user_id FROM users WHERE user_id = ? FOR UPDATE`. MUST be the
   * first statement of the transaction (REPEATABLE READ read view, §0.3).
   * Returns false when the user does not exist.
   */
  async lockUser(tx: Tx, userId: number): Promise<boolean> {
    const rows = await tx
      .select({ userId: users.userId })
      .from(users)
      .where(eq(users.userId, userId))
      .for('update');
    return rows.length > 0;
  }

  /** True when a row carrying `[k:<key>] ` already exists for the user. */
  async hasKey(tx: Tx, userId: number, key: string): Promise<boolean> {
    const pattern = `${escapeLike(awardKeyPrefix(key))}%`;
    const rows = await tx
      .select({ one: sql<number>`1` })
      .from(pointsHistory)
      .where(
        and(
          eq(pointsHistory.userId, userId),
          sql`${pointsHistory.description} COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Running balance = `points_balance_after` of the LATEST row (D1), 0 when none. */
  async latestBalance(tx: Tx, userId: number): Promise<number> {
    const rows = await tx
      .select({ balance: pointsHistory.pointsBalanceAfter })
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId))
      .orderBy(desc(pointsHistory.historyId))
      .limit(1);
    return rows[0]?.balance ?? 0;
  }

  async insert(tx: Tx, row: LedgerInsert): Promise<number> {
    const result = await tx.insert(pointsHistory).values(row);
    return result[0].insertId;
  }
}

export const ledgerRepository = new LedgerRepository();
