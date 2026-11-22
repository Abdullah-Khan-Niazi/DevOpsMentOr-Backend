import { env } from '../../../app/config';
import { logger } from '../../../shared/logger';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { LeaderboardService } from '../services/leaderboard.service';
import { leaderboardService } from '../services/leaderboard.service';

export interface LeaderboardComputationJobDeps {
  repo: Pick<
    GamificationRepository,
    | 'listLeaderboardCandidateUserIds'
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
  leaderboard: Pick<LeaderboardService, 'refreshUserTotals'>;
  intervalMinutes: number;
}

function defaultDeps(): LeaderboardComputationJobDeps {
  return {
    repo: gamificationRepository,
    leaderboard: leaderboardService,
    intervalMinutes: env.LEADERBOARD_RECOMPUTE_INTERVAL_MINUTES,
  };
}

export interface LeaderboardRunResult {
  processedUsers: number;
  snapshotRows: number;
  /** Users whose totals could not be refreshed (logged with their id). */
  failedUsers: number;
}

/**
 * Standard competition ranking (SQL `RANK()`): equal scores share a rank
 * and the next rank skips (100, 90, 90, 80 -> 1, 2, 2, 4). `scores` MUST be
 * sorted descending.
 */
export function competitionRanks(scores: readonly number[]): number[] {
  const ranks: number[] = [];
  scores.forEach((score, index) => {
    ranks.push(index > 0 && score === scores[index - 1] ? ranks[index - 1] : index + 1);
  });
  return ranks;
}

/**
 * F7 §08 scheduled leaderboard job. Every `intervalMinutes` it refreshes
 * every candidate user's totals through `leaderboardService.refreshUserTotals`
 * (the same locked select-then-update/insert used after learning events, so
 * the two can never insert duplicate rows), assigns `global_rank` and
 * `country_rank` with RANK semantics, inserts one `leaderboard_history`
 * snapshot row per user (AC-10), and recomputes `season_leaderboards` within
 * each active season's date window (invariant 7). One run at a time: a
 * manual trigger during a scheduled run joins it.
 */
export class LeaderboardComputationJob {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<LeaderboardRunResult> | null = null;

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
  async triggerManual(): Promise<LeaderboardRunResult> {
    return this.run();
  }

  /** One computation cycle (joins the in-flight one); exposed for tests. */
  run(): Promise<LeaderboardRunResult> {
    if (!this.inFlight) {
      this.inFlight = this.compute().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async compute(): Promise<LeaderboardRunResult> {
    const { repo } = this.deps;
    const userIds = await repo.listLeaderboardCandidateUserIds();
    let failedUsers = 0;
    for (const userId of userIds) {
      try {
        await this.deps.leaderboard.refreshUserTotals(userId);
      } catch (error) {
        failedUsers += 1;
        logger.error({ err: error, userId }, 'Leaderboard totals refresh failed for user');
      }
    }

    const ordered = await repo.listAllLeaderboardRows();
    const globalRanks = competitionRanks(ordered.map((row) => row.totalPoints));
    const snapshotRows: Array<{ userId: number; totalPoints: number; globalRank: number | null }> = [];
    for (const [index, row] of ordered.entries()) {
      const rank = globalRanks[index];
      snapshotRows.push({ userId: row.userId, totalPoints: row.totalPoints, globalRank: rank });
      if (row.globalRank !== rank) {
        await repo.setGlobalRank(row.leaderboardId, rank);
      }
    }

    // Rows arrive ordered by total_points desc, so each country group is too.
    const byCountry = new Map<number, Array<{ leaderboardId: number; totalPoints: number; countryRank: number | null }>>();
    for (const row of await repo.listCountryScopedRows()) {
      const group = byCountry.get(row.countryId) ?? [];
      group.push(row);
      byCountry.set(row.countryId, group);
    }
    for (const group of byCountry.values()) {
      const ranks = competitionRanks(group.map((row) => row.totalPoints));
      for (const [index, row] of group.entries()) {
        if (row.countryRank !== ranks[index]) {
          await repo.setCountryRank(row.leaderboardId, ranks[index]);
        }
      }
    }

    await repo.insertHistorySnapshot(snapshotRows);

    const activeSeasons = (await repo.listSeasons()).filter((season) => season.isActive);
    for (const season of activeSeasons) {
      const seasonSums = await repo.sumPointsBetweenByUser(season.startDate, season.endDate);
      for (const [userId, points] of seasonSums) {
        await repo.upsertSeasonLeaderboard(season.seasonId, userId, points);
      }
      const seasonOrdered = await repo.listAllSeasonRows(season.seasonId);
      const seasonRanks = competitionRanks(seasonOrdered.map((row) => row.pointsEarned));
      for (const [index, row] of seasonOrdered.entries()) {
        await repo.setSeasonRank(row.leaderboardId, seasonRanks[index]);
      }
    }

    logger.info(
      {
        processedUsers: userIds.length,
        failedUsers,
        snapshotRows: snapshotRows.length,
        activeSeasons: activeSeasons.length,
      },
      'Leaderboard computation run completed',
    );
    return { processedUsers: userIds.length, snapshotRows: snapshotRows.length, failedUsers };
  }
}

export const leaderboardComputationJob = new LeaderboardComputationJob();