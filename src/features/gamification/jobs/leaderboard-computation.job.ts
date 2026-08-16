import { env } from '../../../app/config';
import { logger } from '../../../shared/logger';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface LeaderboardComputationJobDeps {
  repo: Pick<
    GamificationRepository,
    | 'sumPointsByUser'
    | 'countCourseCompletionsByUser'
    | 'upsertLeaderboard'
    | 'listAllLeaderboardRows'
    | 'setGlobalRank'
    | 'listCountryScopedRows'
    | 'setCountryRank'
    | 'insertHistorySnapshot'
    | 'listSeasons'
    | 'sumPointsBetweenByUser'
    | 'upsertSeasonLeaderboard'
    | 'listAllSeasonRows'
    | 'setSeasonRank'
  >;
  intervalMinutes: number;
}

function defaultDeps(): LeaderboardComputationJobDeps {
  return {
    repo: gamificationRepository,
    intervalMinutes: env.LEADERBOARD_RECOMPUTE_INTERVAL_MINUTES,
  };
}

/**
 * F7 §08 scheduled leaderboard job. Every `intervalMinutes` it aggregates
 * `points_history` into `leaderboards` (invariant 6), assigns `global_rank`
 * via RANK()-equivalent ordering and `country_rank` scoped by
 * `user_profiles.country_id`, inserts one `leaderboard_history` snapshot row
 * per user (AC-10), and recomputes `season_leaderboards` within each active
 * season's date window (invariant 7). Never real-time; failures are logged.
 */
export class LeaderboardComputationJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: LeaderboardComputationJobDeps = defaultDeps()) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.run().catch((error) => {
        logger.error({ err: error }, 'Leaderboard computation run failed');
      });
    }, this.deps.intervalMinutes * 60 * 1000);
    this.timer.unref();
    logger.info(`Leaderboard computation job started (interval: ${this.deps.intervalMinutes}m)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** GAM-23: manual recompute trigger (one full run). */
  async triggerManual(): Promise<{ processedUsers: number; snapshotRows: number }> {
    return this.run();
  }

  /** One computation cycle; exposed for tests. */
  async run(): Promise<{ processedUsers: number; snapshotRows: number }> {
    const [sums, completions] = await Promise.all([
      this.deps.repo.sumPointsByUser(),
      this.deps.repo.countCourseCompletionsByUser(),
    ]);

    const userIds = new Set<number>([...sums.keys(), ...completions.keys()]);
    for (const userId of userIds) {
      await this.deps.repo.upsertLeaderboard(
        userId,
        sums.get(userId) ?? 0,
        completions.get(userId) ?? 0,
      );
    }

    const ordered = await this.deps.repo.listAllLeaderboardRows();
    const snapshotRows: Array<{ userId: number; totalPoints: number; globalRank: number | null }> = [];
    ordered.forEach((row, index) => {
      const rank = index + 1;
      snapshotRows.push({ userId: row.userId, totalPoints: row.totalPoints, globalRank: rank });
    });
    for (const [index, row] of ordered.entries()) {
      await this.deps.repo.setGlobalRank(row.leaderboardId, index + 1);
    }

    const countryScoped = await this.deps.repo.listCountryScopedRows();
    const byCountry = new Map<number, Array<{ leaderboardId: number; userId: number }>>();
    for (const row of countryScoped) {
      const group = byCountry.get(row.countryId) ?? [];
      group.push({ leaderboardId: row.leaderboardId, userId: row.userId });
      byCountry.set(row.countryId, group);
    }
    for (const group of byCountry.values()) {
      // Rows are already ordered by total_points desc from the repository.
      for (const [index, row] of group.entries()) {
        await this.deps.repo.setCountryRank(row.leaderboardId, index + 1);
      }
    }

    await this.deps.repo.insertHistorySnapshot(snapshotRows);

    const activeSeasons = (await this.deps.repo.listSeasons()).filter((season) => season.isActive);
    for (const season of activeSeasons) {
      const seasonSums = await this.deps.repo.sumPointsBetweenByUser(season.startDate, season.endDate);
      for (const [userId, points] of seasonSums) {
        await this.deps.repo.upsertSeasonLeaderboard(season.seasonId, userId, points);
      }
      const seasonOrdered = await this.deps.repo.listAllSeasonRows(season.seasonId);
      for (const [index, row] of seasonOrdered.entries()) {
        await this.deps.repo.setSeasonRank(row.leaderboardId, index + 1);
      }
    }

    logger.info(
      { processedUsers: userIds.size, snapshotRows: snapshotRows.length, activeSeasons: activeSeasons.length },
      'Leaderboard computation run completed',
    );
    return { processedUsers: userIds.size, snapshotRows: snapshotRows.length };
  }
}

export const leaderboardComputationJob = new LeaderboardComputationJob();