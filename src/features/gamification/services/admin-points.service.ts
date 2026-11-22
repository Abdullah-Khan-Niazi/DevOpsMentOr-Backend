import { NotFoundError } from '../../../shared/errors';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { PointsService } from './points.service';
import { pointsService } from './points.service';
import type { LeaderboardService } from './leaderboard.service';
import { leaderboardService } from './leaderboard.service';

export interface AdminPointsServiceDeps {
  repo: Pick<GamificationRepository, 'findUser'>;
  points: Pick<PointsService, 'credit'>;
  leaderboard: Pick<LeaderboardService, 'refreshUserTotals'>;
}

function defaultDeps(): AdminPointsServiceDeps {
  return { repo: gamificationRepository, points: pointsService, leaderboard: leaderboardService };
}

/**
 * GAM-21: platform-admin manual point adjustment. Writes a keyed
 * `admin_adjustment` ledger row (never mutates existing rows) through
 * `pointsService.credit`, then refreshes the user's `leaderboards` totals;
 * ranks are recomputed by the scheduled job.
 */
export class AdminPointsService {
  constructor(private readonly deps: AdminPointsServiceDeps = defaultDeps()) {}

  async adjust(
    targetUserId: number,
    pointsChange: number,
    description: string,
  ): Promise<{ historyId: number | null; newBalance: number }> {
    const user = await this.deps.repo.findUser(targetUserId);
    if (!user) {
      throw new NotFoundError('Target user not found.');
    }
    const { historyId, newBalance } = await this.deps.points.credit(
      targetUserId,
      pointsChange,
      'admin_adjustment',
      null,
      description,
    );
    await this.deps.leaderboard.refreshUserTotals(targetUserId);
    return { historyId, newBalance };
  }
}

export const adminPointsService = new AdminPointsService();
