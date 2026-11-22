import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { PointsHistoryDto, PointsSourceType } from '../dto/gamification.dto';
import { awardKeys, parseAwardKey } from '../config/award-keys';
import type { AwardService } from './award.service';
import { awardService } from './award.service';

export interface PointsServiceDeps {
  repo: Pick<GamificationRepository, 'getBalance' | 'listPointsHistory'>;
  awards: Pick<AwardService, 'applyLocked'>;
}

function defaultDeps(): PointsServiceDeps {
  return { repo: gamificationRepository, awards: awardService };
}

/**
 * F7 points ledger service. Every write goes through `awardService` (contracts
 * §0.3, §5.2): `credit` is a thin wrapper that records a keyed admin adjustment
 * under the user lock. The ledger is append-only: no UPDATE or DELETE path exists.
 */
export class PointsService {
  constructor(private readonly deps: PointsServiceDeps = defaultDeps()) {}

  async getBalance(userId: number): Promise<{ balance: number; totalEarned: number }> {
    return this.deps.repo.getBalance(userId);
  }

  /** Admin adjustment (signed delta, 0 writes nothing); returns the new running balance. */
  async credit(
    userId: number,
    pointsChange: number,
    sourceType: Extract<PointsSourceType, 'admin_adjustment'>,
    sourceId?: number | null,
    description?: string | null,
  ): Promise<{ historyId: number | null; newBalance: number }> {
    const result = await this.deps.awards.applyLocked({
      userId,
      key: awardKeys.admin(),
      points: pointsChange,
      sourceType,
      sourceId: sourceId ?? null,
      label: description ?? 'Admin adjustment',
    });
    return { historyId: result.historyId, newBalance: result.balance };
  }

  async getHistory(userId: number, page: number, limit: number): Promise<{
    items: PointsHistoryDto[];
    total: number;
  }> {
    const { rows, total } = await this.deps.repo.listPointsHistory(userId, page, limit);
    return {
      items: rows.map((row) => {
        const parsed = parseAwardKey(row.description);
        return {
          historyId: row.historyId,
          pointsChange: row.pointsChange,
          pointsBalanceAfter: row.pointsBalanceAfter,
          sourceType: row.sourceType as PointsSourceType,
          sourceId: row.sourceId,
          kind: parsed.kind,
          description: parsed.label.length > 0 ? parsed.label : null,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      total,
    };
  }
}

export const pointsService = new PointsService();
