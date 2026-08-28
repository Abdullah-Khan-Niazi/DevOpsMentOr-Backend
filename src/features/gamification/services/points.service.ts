import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { PointsHistoryDto, PointsSourceType } from '../dto/gamification.dto';

export interface PointsServiceDeps {
  repo: Pick<GamificationRepository, 'getBalance' | 'insertPoints' | 'listPointsHistory'>;
}

function defaultDeps(): PointsServiceDeps {
  return { repo: gamificationRepository };
}

/**
 * F7 points ledger service (invariant 3). `credit` performs an atomic
 * INSERT into `points_history` computing `points_balance_after` inside a
 * transaction. The ledger is append-only: no UPDATE or DELETE path exists.
 */
export class PointsService {
  constructor(private readonly deps: PointsServiceDeps = defaultDeps()) {}

  async getBalance(userId: number): Promise<{ balance: number; totalEarned: number }> {
    return this.deps.repo.getBalance(userId);
  }

  /** Atomic ledger credit/debit; returns the new running balance. */
  async credit(
    userId: number,
    pointsChange: number,
    sourceType: PointsSourceType,
    sourceId?: number | null,
    description?: string | null,
  ): Promise<{ historyId: number; newBalance: number }> {
    return this.deps.repo.insertPoints({
      userId,
      pointsChange,
      sourceType,
      sourceId,
      description,
    });
  }

  async getHistory(userId: number, page: number, limit: number): Promise<{
    items: PointsHistoryDto[];
    total: number;
  }> {
    const { rows, total } = await this.deps.repo.listPointsHistory(userId, page, limit);
    return {
      items: rows.map((row) => ({
        historyId: row.historyId,
        pointsChange: row.pointsChange,
        pointsBalanceAfter: row.pointsBalanceAfter,
        sourceType: row.sourceType as PointsSourceType,
        sourceId: row.sourceId,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }
}

export const pointsService = new PointsService();
