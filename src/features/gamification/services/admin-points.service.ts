import { NotFoundError } from '../../../shared/errors';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { PointsService } from './points.service';
import { pointsService } from './points.service';

export interface AdminPointsServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'findUser'
    | 'sumPointsForUser'
    | 'countCourseCompletionsForUser'
    | 'upsertLeaderboard'
  >;
  points: Pick<PointsService, 'credit'>;
}

function defaultDeps(): AdminPointsServiceDeps {
  return { repo: gamificationRepository, points: pointsService };
}

/**
 * GAM-21: platform-admin manual point adjustment. Writes a new
 * `admin_adjustment` ledger row (never mutates existing rows) and refreshes
 * the user's `leaderboards` row; ranks are recomputed by the scheduled job.
 */
export class AdminPointsService {
  constructor(private readonly deps: AdminPointsServiceDeps = defaultDeps()) {}

  async adjust(
    targetUserId: number,
    pointsChange: number,
    description: string,
  ): Promise<{ historyId: number; newBalance: number }> {
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
    const [totalPoints, courseCompletionsCount] = await Promise.all([
      this.deps.repo.sumPointsForUser(targetUserId),
      this.deps.repo.countCourseCompletionsForUser(targetUserId),
    ]);
    await this.deps.repo.upsertLeaderboard(targetUserId, totalPoints, courseCompletionsCount);
    return { historyId, newBalance };
  }
}

export const adminPointsService = new AdminPointsService();
