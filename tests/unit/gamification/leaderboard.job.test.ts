import { describe, expect, it, vi } from 'vitest';
import {
  LeaderboardComputationJob,
  competitionRanks,
} from '../../../src/features/gamification/jobs/leaderboard-computation.job';
import { LeaderboardService } from '../../../src/features/gamification/services/leaderboard.service';

describe('competitionRanks (RANK semantics)', () => {
  it('gives equal scores the same rank and skips the next rank', () => {
    expect(competitionRanks([100, 90, 90, 80])).toEqual([1, 2, 2, 4]);
  });

  it('shares rank 1 across a tie at the top', () => {
    expect(competitionRanks([50, 50, 10])).toEqual([1, 1, 3]);
  });

  it('gives every member of a full tie rank 1', () => {
    expect(competitionRanks([7, 7, 7])).toEqual([1, 1, 1]);
  });

  it('returns no ranks for an empty board', () => {
    expect(competitionRanks([])).toEqual([]);
  });
});

describe('LeaderboardComputationJob ranking', () => {
  it('writes tied users the same global rank and the next rank skips', async () => {
    const repo = {
      listLeaderboardCandidateUserIds: vi.fn().mockResolvedValue([1, 2, 3, 4]),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([
        { leaderboardId: 11, userId: 1, totalPoints: 100, globalRank: null },
        { leaderboardId: 12, userId: 2, totalPoints: 90, globalRank: null },
        { leaderboardId: 13, userId: 3, totalPoints: 90, globalRank: null },
        { leaderboardId: 14, userId: 4, totalPoints: 80, globalRank: null },
      ]),
      setGlobalRank: vi.fn().mockResolvedValue(undefined),
      listCountryScopedRows: vi.fn().mockResolvedValue([]),
      setCountryRank: vi.fn(),
      insertHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      listSeasons: vi.fn().mockResolvedValue([]),
    };
    const leaderboard = { refreshUserTotals: vi.fn().mockResolvedValue({ totalPoints: 0, courseCompletionsCount: 0 }) };
    const job = new LeaderboardComputationJob({ repo: repo as never, leaderboard, intervalMinutes: 15 });

    const result = await job.run();

    expect(result.processedUsers).toBe(4);
    expect(repo.setGlobalRank.mock.calls).toEqual([[11, 1], [12, 2], [13, 2], [14, 4]]);
    expect(repo.insertHistorySnapshot).toHaveBeenCalledWith([
      { userId: 1, totalPoints: 100, globalRank: 1 },
      { userId: 2, totalPoints: 90, globalRank: 2 },
      { userId: 3, totalPoints: 90, globalRank: 2 },
      { userId: 4, totalPoints: 80, globalRank: 4 },
    ]);
  });

  it('keeps going when one user refresh fails and counts it', async () => {
    const repo = {
      listLeaderboardCandidateUserIds: vi.fn().mockResolvedValue([1, 2]),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([]),
      listCountryScopedRows: vi.fn().mockResolvedValue([]),
      insertHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      listSeasons: vi.fn().mockResolvedValue([]),
    };
    const leaderboard = {
      refreshUserTotals: vi.fn()
        .mockRejectedValueOnce(new Error('lock wait timeout'))
        .mockResolvedValueOnce({ totalPoints: 5, courseCompletionsCount: 0 }),
    };
    const job = new LeaderboardComputationJob({ repo: repo as never, leaderboard, intervalMinutes: 15 });

    const result = await job.run();

    expect(result).toEqual({ processedUsers: 2, snapshotRows: 0, failedUsers: 1 });
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledTimes(2);
  });
});

describe('LeaderboardService.refreshUserTotals', () => {
  const tx = { tag: 'tx' };

  function makeService(leaderboardIds: number[]) {
    const repo = {
      sumPointsForUser: vi.fn().mockResolvedValue(120),
      countCourseCompletionsForUser: vi.fn().mockResolvedValue(2),
      listLeaderboardIdsForUser: vi.fn().mockResolvedValue(leaderboardIds),
      insertLeaderboard: vi.fn().mockResolvedValue(77),
      updateLeaderboardTotals: vi.fn().mockResolvedValue(undefined),
      deleteOtherLeaderboardRows: vi.fn().mockResolvedValue(undefined),
    };
    const award = {
      withUserLock: vi.fn(async (_userId: number, fn: (transaction: unknown) => Promise<unknown>) => fn(tx)),
    };
    const service = new LeaderboardService({
      repo: repo as never,
      memberships: {} as never,
      award: award as never,
    });
    return { service, repo, award };
  }

  it('inserts the totals under the user lock when the user has no leaderboard row', async () => {
    const { service, repo, award } = makeService([]);

    const totals = await service.refreshUserTotals(5);

    expect(totals).toEqual({ totalPoints: 120, courseCompletionsCount: 2 });
    expect(award.withUserLock).toHaveBeenCalledWith(5, expect.any(Function));
    expect(repo.sumPointsForUser).toHaveBeenCalledWith(5, tx);
    expect(repo.countCourseCompletionsForUser).toHaveBeenCalledWith(5, tx);
    expect(repo.insertLeaderboard).toHaveBeenCalledWith(5, { totalPoints: 120, courseCompletionsCount: 2 }, tx);
    expect(repo.updateLeaderboardTotals).not.toHaveBeenCalled();
    expect(repo.deleteOtherLeaderboardRows).not.toHaveBeenCalled();
  });

  it('updates the existing row (oldest id) instead of inserting a second one', async () => {
    const { service, repo } = makeService([7]);

    await service.refreshUserTotals(5);

    expect(repo.listLeaderboardIdsForUser).toHaveBeenCalledWith(5, tx);
    expect(repo.updateLeaderboardTotals).toHaveBeenCalledWith(7, { totalPoints: 120, courseCompletionsCount: 2 }, tx);
    expect(repo.insertLeaderboard).not.toHaveBeenCalled();
  });

  it('removes legacy duplicate rows while keeping the oldest one', async () => {
    const { service, repo } = makeService([7, 9, 11]);

    await service.refreshUserTotals(5);

    expect(repo.updateLeaderboardTotals).toHaveBeenCalledWith(7, expect.any(Object), tx);
    expect(repo.deleteOtherLeaderboardRows).toHaveBeenCalledWith(5, 7, tx);
    expect(repo.insertLeaderboard).not.toHaveBeenCalled();
  });
});
