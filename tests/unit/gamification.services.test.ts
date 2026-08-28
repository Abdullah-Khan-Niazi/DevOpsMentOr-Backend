import { describe, expect, it, vi } from 'vitest';
import type { LearnerProgressSnapshot } from '../../src/features/progress/dto/progress.dto';
import { achievementEvaluator } from '../../src/features/gamification/engines/achievement-evaluator.engine';
import { BadgeAwardEngine } from '../../src/features/gamification/engines/badge-award.engine';
import { GamificationEventHandler } from '../../src/features/gamification/handlers/gamification-event.handler';
import { LeaderboardComputationJob } from '../../src/features/gamification/jobs/leaderboard-computation.job';
import { AdminAchievementService } from '../../src/features/gamification/services/admin-achievement.service';
import { AdminBadgeService } from '../../src/features/gamification/services/admin-badge.service';
import { AdminCertificateService } from '../../src/features/gamification/services/admin-certificate.service';
import { AdminPointsService } from '../../src/features/gamification/services/admin-points.service';
import { AdminSeasonService } from '../../src/features/gamification/services/admin-season.service';
import { CertificateService } from '../../src/features/gamification/services/certificate.service';
import { GamificationService } from '../../src/features/gamification/services/gamification.service';
import { LeaderboardService } from '../../src/features/gamification/services/leaderboard.service';
import { PointsService } from '../../src/features/gamification/services/points.service';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';

const snapshot: LearnerProgressSnapshot = {
  userId: 1,
  courseProgressPct: 100,
  completedLessonCount: 10,
  completedModuleCount: 2,
  completedLabCount: 5,
  quizPassCount: 3,
  lastActivityAt: new Date(),
  currentStreakDays: 7,
};

describe('AchievementEvaluator', () => {
  const context = { pointsBalance: 120 };

  it('unlocks when completed labs reach the threshold', () => {
    const result = achievementEvaluator.evaluate(
      snapshot,
      { triggerType: 'lab_completions', triggerValue: { count: 5 } },
      context,
    );
    expect(result.unlocked).toBe(true);
  });

  it('does not unlock below the lab threshold', () => {
    const result = achievementEvaluator.evaluate(
      snapshot,
      { triggerType: 'lab_completions', triggerValue: { count: 6 } },
      context,
    );
    expect(result.unlocked).toBe(false);
  });

  it('unlocks course completion achievements only at 100%', () => {
    const partial: LearnerProgressSnapshot = { ...snapshot, courseProgressPct: 99 };
    expect(achievementEvaluator.evaluate(partial, { triggerType: 'course_completions', triggerValue: { count: 1 } }, context).unlocked).toBe(false);
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'course_completions', triggerValue: { count: 1 } }, context).unlocked).toBe(true);
  });

  it('evaluates streak_days against the current streak', () => {
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'streak_days', triggerValue: { count: 7 } }, context).unlocked).toBe(true);
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'streak_days', triggerValue: { count: 8 } }, context).unlocked).toBe(false);
  });

  it('evaluates points_balance against the running balance', () => {
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'points_balance', triggerValue: { balance: 100 } }, context).unlocked).toBe(true);
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'points_balance', triggerValue: { balance: 121 } }, context).unlocked).toBe(false);
  });

  it('never unlocks unknown or null trigger types', () => {
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: null, triggerValue: null }, context).unlocked).toBe(false);
    expect(achievementEvaluator.evaluate(snapshot, { triggerType: 'unknown_trigger', triggerValue: null }, context).unlocked).toBe(false);
  });
});

describe('BadgeAwardEngine', () => {
  const badge = (overrides: Record<string, unknown>) => ({
    badgeId: 1,
    badgeName: 'Test Badge',
    slug: 'test-badge',
    description: null,
    badgeType: 'gold',
    iconUrl: null,
    pointsRequired: 50,
    isHidden: false,
    createdAt: new Date(),
    criteria: null,
    ...overrides,
  });

  it('matches course_complete badges only on full course progress', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, points: {} as never });
    const result = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'course_complete', triggerValue: {} } }), { pointsBalance: 0, unlockedAchievementIds: new Set() });
    expect(result.matched).toBe(true);
    expect(result.reason).toBe('Completed the full course.');
  });

  it('matches lab_complete badges by completed lab count', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, points: {} as never });
    const result = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'lab_complete', triggerValue: { count: 5 } } }), { pointsBalance: 0, unlockedAchievementIds: new Set() });
    expect(result.matched).toBe(true);
  });

  it('never auto-awards manual badges', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, points: {} as never });
    const result = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'manual', triggerValue: {} } }), { pointsBalance: 0, unlockedAchievementIds: new Set() });
    expect(result.matched).toBe(false);
  });

  it('evaluateAndAward is idempotent and credits points through the ledger', async () => {
    const repo = {
      listBadgesWithCriteria: vi.fn().mockResolvedValue([
        badge({ criteria: { triggerType: 'lab_complete', triggerValue: { count: 5 } } }),
      ]),
      hasUserBadge: vi.fn().mockResolvedValue(false),
      insertUserBadge: vi.fn().mockResolvedValue(1),
    };
    const points = { credit: vi.fn().mockResolvedValue({ historyId: 1, newBalance: 50 }) };
    const engine = new BadgeAwardEngine({ repo: repo as never, points: points as never });

    const events = await engine.evaluateAndAward(1, snapshot, { pointsBalance: 0, unlockedAchievementIds: new Set() });

    expect(events).toHaveLength(1);
    expect(events[0].badgeName).toBe('Test Badge');
    expect(points.credit).toHaveBeenCalledWith(1, 50, 'achievement', 1, 'Badge awarded: Test Badge');

    repo.hasUserBadge.mockResolvedValue(true);
    await engine.evaluateAndAward(1, snapshot, { pointsBalance: 0, unlockedAchievementIds: new Set() });
    expect(repo.insertUserBadge).toHaveBeenCalledTimes(1);
  });
});

describe('PointsService', () => {
  it('getBalance delegates to the repository', async () => {
    const repo = { getBalance: vi.fn().mockResolvedValue({ balance: 120, totalEarned: 300 }) };
    const service = new PointsService({ repo: repo as never });
    await expect(service.getBalance(1)).resolves.toEqual({ balance: 120, totalEarned: 300 });
  });

  it('credit writes an append-only ledger row', async () => {
    const repo = { insertPoints: vi.fn().mockResolvedValue({ historyId: 9, newBalance: 60 }) };
    const service = new PointsService({ repo: repo as never });
    const result = await service.credit(1, 10, 'admin_adjustment', null, 'Manual adjustment');
    expect(result).toEqual({ historyId: 9, newBalance: 60 });
    expect(repo.insertPoints).toHaveBeenCalledWith({
      userId: 1,
      pointsChange: 10,
      sourceType: 'admin_adjustment',
      sourceId: null,
      description: 'Manual adjustment',
    });
  });

  it('maps history rows to ISO-string DTOs', async () => {
    const repo = {
      listPointsHistory: vi.fn().mockResolvedValue({
        rows: [{
          historyId: 3,
          pointsChange: 5,
          pointsBalanceAfter: 5,
          sourceType: 'achievement',
          sourceId: 7,
          description: 'x',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }],
        total: 1,
      }),
    };
    const service = new PointsService({ repo: repo as never });
    const history = await service.getHistory(1, 1, 25);
    expect(history.items[0]).toMatchObject({
      historyId: 3,
      pointsChange: 5,
      sourceType: 'achievement',
      sourceId: 7,
    });
    expect(history.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('CertificateService', () => {
  const repo = {
    countTotalPublishedLessons: vi.fn(),
    countCompletedLessons: vi.fn(),
    listRequiredQuizIds: vi.fn(),
    countPassedRequiredQuizzes: vi.fn(),
    findCertificateByUserCourse: vi.fn(),
    getGradeData: vi.fn(),
    insertCertificate: vi.fn(),
    findCertificateByNumber: vi.fn(),
    updateVerifierIp: vi.fn(),
    findUserName: vi.fn(),
    findCertificateById: vi.fn(),
  };
  const deps = { repo: repo as never, verifyBaseUrl: 'https://verify.example.com', maxNumberCollisionRetries: 3 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects issuance before full course completion', async () => {
    repo.countTotalPublishedLessons.mockResolvedValue(10);
    repo.countCompletedLessons.mockResolvedValue(9);
    repo.listRequiredQuizIds.mockResolvedValue([1]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(1);
    const service = new CertificateService(deps);
    await expect(service.issueCertificate(1, 2)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('issues a certificate idempotently with a graded average', async () => {
    repo.countTotalPublishedLessons.mockResolvedValue(10);
    repo.countCompletedLessons.mockResolvedValue(10);
    repo.listRequiredQuizIds.mockResolvedValue([1, 2]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(2);
    repo.findCertificateByUserCourse.mockResolvedValue(null);
    repo.getGradeData.mockResolvedValue({ passedSum: 185, passedCount: 2 });
    repo.insertCertificate.mockResolvedValue(11);

    const service = new CertificateService(deps);
    const cert = await service.issueCertificate(1, 2);

    expect(cert.grade).toBe(92.5);
    expect(cert.isValid).toBe(true);
    expect(cert.certificateNumber).toMatch(/^DM-\d{4}-[0-9a-fA-F]{8}$/);
    expect(repo.insertCertificate).toHaveBeenCalledWith(expect.objectContaining({ grade: '92.5' }));

    repo.findCertificateByUserCourse.mockResolvedValue({
      certificateId: 11,
      userId: 1,
      courseId: 2,
      certificateNumber: 'DM-2026-abcdef12',
      grade: '92.5',
      certificateUrl: 'https://verify.example.com/verify/DM-2026-abcdef12',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      isValid: true,
      courseTitle: 'DevOps Fundamentals',
    });
    const again = await service.issueCertificate(1, 2);
    expect(again.certificateId).toBe(11);
    expect(repo.insertCertificate).toHaveBeenCalledTimes(1);
  });

  it('fails with ConflictError when certificate numbers keep colliding', async () => {
    repo.countTotalPublishedLessons.mockResolvedValue(10);
    repo.countCompletedLessons.mockResolvedValue(10);
    repo.listRequiredQuizIds.mockResolvedValue([]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(0);
    repo.findCertificateByUserCourse.mockResolvedValue(null);
    repo.getGradeData.mockResolvedValue({ passedSum: 0, passedCount: 0 });
    repo.insertCertificate.mockRejectedValue(new Error('duplicate key'));

    const service = new CertificateService(deps);
    await expect(service.issueCertificate(1, 2)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.insertCertificate).toHaveBeenCalledTimes(3);
  });

  it('verify exposes no sensitive fields and records the verifier IP', async () => {
    repo.findCertificateByNumber.mockResolvedValue({
      certificateId: 5,
      userId: 1,
      courseId: 2,
      certificateNumber: 'DM-2026-abcdef12',
      grade: '92.5',
      certificateUrl: 'https://verify.example.com/verify/DM-2026-abcdef12',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      isValid: true,
      courseTitle: 'DevOps Fundamentals',
    });
    repo.findUserName.mockResolvedValue({ fullName: 'Jane Doe' });
    const service = new CertificateService(deps);

    const verification = await service.verify('DM-2026-abcdef12', '203.0.113.9');

    expect(verification).toEqual({
      certificateNumber: 'DM-2026-abcdef12',
      holderName: 'Jane Doe',
      courseTitle: 'DevOps Fundamentals',
      issuedAt: '2026-01-01T00:00:00.000Z',
      isValid: true,
    });
    expect(verification).not.toHaveProperty('userId');
    expect(verification).not.toHaveProperty('grade');
    expect(verification).not.toHaveProperty('certificateUrl');
    expect(repo.updateVerifierIp).toHaveBeenCalledWith(5, '203.0.113.9');
  });

  it('verify rejects unknown numbers', async () => {
    repo.findCertificateByNumber.mockResolvedValue(null);
    const service = new CertificateService(deps);
    await expect(service.verify('DM-2026-00000000', undefined)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('verify reports revoked certificates as invalid', async () => {
    repo.findCertificateByNumber.mockResolvedValue({
      certificateId: 5,
      userId: 1,
      courseId: 2,
      certificateNumber: 'DM-2026-abcdef12',
      grade: null,
      certificateUrl: null,
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
      isValid: false,
      courseTitle: 'DevOps Fundamentals',
    });
    repo.findUserName.mockResolvedValue({ fullName: 'Jane Doe' });
    const service = new CertificateService(deps);
    const verification = await service.verify('DM-2026-abcdef12', undefined);
    expect(verification.isValid).toBe(false);
  });
});

describe('GamificationEventHandler', () => {
  const repo = {
    getBalance: vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    listActiveAchievements: vi.fn().mockResolvedValue([]),
    hasUserAchievement: vi.fn(),
    insertUserAchievement: vi.fn(),
    listUnlockedAchievementIds: vi.fn().mockResolvedValue([]),
    getCanonicalCourseId: vi.fn().mockResolvedValue(2),
  };
  const evaluator = { evaluate: vi.fn() };
  const badges = { evaluateAndAward: vi.fn().mockResolvedValue([]) };
  const points = { credit: vi.fn() };
  const certificates = { issueCertificate: vi.fn() };

  const service = new GamificationEventHandler({
    repo: repo as never,
    evaluator: evaluator as never,
    badges: badges as never,
    points: points as never,
    certificates: certificates as never,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unlocks achievements once, credits points, then evaluates badges', async () => {
    repo.listActiveAchievements.mockResolvedValue([
      { achievementId: 1, name: 'First Lab', pointsAwarded: 20, triggerType: 'lab_completions', triggerValue: { count: 1 }, isActive: true },
    ]);
    evaluator.evaluate.mockReturnValue({ unlocked: true, progressData: { completedLabCount: 5 } });
    repo.hasUserAchievement.mockResolvedValue(false);
    repo.getBalance.mockResolvedValueOnce({ balance: 0, totalEarned: 0 }).mockResolvedValueOnce({ balance: 20, totalEarned: 20 });

    const result = await service.handleProgressSnapshot(snapshot);

    expect(repo.insertUserAchievement).toHaveBeenCalledWith(1, 1, { completedLabCount: 5 });
    expect(points.credit).toHaveBeenCalledWith(1, 20, 'achievement', 1, 'Achievement unlocked: First Lab');
    expect(badges.evaluateAndAward).toHaveBeenCalledWith(1, snapshot, { pointsBalance: 20, unlockedAchievementIds: new Set() });
    expect(result.achievementsUnlocked).toHaveLength(1);
    expect(result.certificateIssued).toBe(true);
    expect(certificates.issueCertificate).toHaveBeenCalledWith(1, 2);
  });

  it('never re-unlocks an already unlocked achievement', async () => {
    repo.hasUserAchievement.mockResolvedValue(true);
    const result = await service.handleProgressSnapshot(snapshot);
    expect(result.achievementsUnlocked).toHaveLength(0);
    expect(repo.insertUserAchievement).not.toHaveBeenCalled();
  });

  it('skips certificate issuance when no canonical course exists', async () => {
    repo.getCanonicalCourseId.mockResolvedValue(null);
    const result = await service.handleProgressSnapshot({ ...snapshot, courseProgressPct: 100 });
    expect(result.certificateIssued).toBe(false);
    expect(certificates.issueCertificate).not.toHaveBeenCalled();
    repo.getCanonicalCourseId.mockResolvedValue(2);
  });
});

describe('GamificationService', () => {
  it('composes the learner profile from repository and progress data', async () => {
    const repo = {
      getBalance: vi.fn().mockResolvedValue({ balance: 40, totalEarned: 90 }),
      findLeaderboardForUser: vi.fn().mockResolvedValue({ globalRank: 3, countryRank: 1 }),
      listUserBadges: vi.fn().mockResolvedValue([
        { badgeId: 1, badgeName: 'First Lab', badgeType: 'bronze', iconUrl: null, awardedAt: new Date('2026-01-01T00:00:00Z') },
      ]),
      listUserAchievements: vi.fn().mockResolvedValue([]),
      listUserCertificates: vi.fn().mockResolvedValue([]),
      listUserActivityDates: vi.fn().mockResolvedValue([new Date('2026-01-01T00:00:00Z')]),
    };
    const service = new GamificationService({
      repo: repo as never,
      progress: { computeStreak: vi.fn().mockReturnValue(2) } as never,
      handler: { handleProgressSnapshot: vi.fn() } as never,
      leaderboard: { getGamificationSummary: vi.fn() } as never,
    });

    const profile = await service.getMyProfile(1);

    expect(profile.points).toEqual({ balance: 40, totalEarned: 90 });
    expect(profile.globalRank).toBe(3);
    expect(profile.countryRank).toBe(1);
    expect(profile.currentStreakDays).toBe(2);
    expect(profile.badges[0]).toMatchObject({ badgeId: 1, badgeName: 'First Lab' });
  });
});

describe('AdminBadgeService', () => {
  it('rejects duplicate badge names', async () => {
    const repo = {
      findBadgeByName: vi.fn().mockResolvedValue({ badgeId: 9 }),
      findBadgeBySlug: vi.fn().mockResolvedValue(null),
      insertBadge: vi.fn(),
      findBadge: vi.fn(),
    };
    const service = new AdminBadgeService({ repo: repo as never });
    await expect(service.create({
      badgeName: 'Dup',
      slug: 'dup',
      badgeType: 'gold',
      pointsRequired: 10,
      isHidden: false,
    })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('AdminAchievementService', () => {
  it('updates an existing achievement', async () => {
    const repo = {
      findAchievement: vi.fn()
        .mockResolvedValueOnce({
          achievementId: 1, name: 'Old', description: null, pointsAwarded: 10,
          triggerType: 'lab_completions', triggerValue: { count: 1 }, isActive: true, createdAt: new Date(),
        })
        .mockResolvedValue({
          achievementId: 1, name: 'New', description: null, pointsAwarded: 10,
          triggerType: 'lab_completions', triggerValue: { count: 1 }, isActive: false, createdAt: new Date(),
        }),
      findAchievementByName: vi.fn().mockResolvedValue(null),
      updateAchievement: vi.fn(),
    };
    const service = new AdminAchievementService({ repo: repo as never });
    const updated = await service.update(1, { name: 'New', isActive: false });
    expect(updated.name).toBe('New');
    expect(repo.updateAchievement).toHaveBeenCalledWith(1, { name: 'New', isActive: false });
  });
});

describe('AdminSeasonService', () => {
  const baseRepo = {
    findSeason: vi.fn().mockResolvedValue(null),
    findOverlappingSeasons: vi.fn().mockResolvedValue([]),
    insertSeason: vi.fn().mockResolvedValue(5),
    updateSeason: vi.fn(),
    replaceSeasonContent: vi.fn(),
    labExists: vi.fn(),
  };

  it('creates a season when dates do not overlap', async () => {
    baseRepo.findSeason.mockResolvedValue({
      seasonId: 5, seasonName: 'S1', seasonNumber: 1, description: null, bannerUrl: null,
      startDate: '2026-01-01', endDate: '2026-03-31', isActive: true,
    });
    const service = new AdminSeasonService({ repo: baseRepo as never });
    const season = await service.create({
      seasonName: 'S1', seasonNumber: 1, startDate: '2026-01-01', endDate: '2026-03-31', isActive: true,
    });
    expect(season.seasonId).toBe(5);
    expect(baseRepo.insertSeason).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping season dates (AC-09)', async () => {
    baseRepo.findOverlappingSeasons.mockResolvedValue([{ seasonId: 2 }]);
    const service = new AdminSeasonService({ repo: baseRepo as never });
    await expect(service.create({
      seasonName: 'S2', seasonNumber: 2, startDate: '2026-02-01', endDate: '2026-04-30', isActive: false,
    })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects season content referencing a non-existent lab', async () => {
    baseRepo.findOverlappingSeasons.mockResolvedValue([]);
    baseRepo.findSeason.mockResolvedValue({
      seasonId: 5, seasonName: 'S1', seasonNumber: 1, description: null, bannerUrl: null,
      startDate: '2026-01-01', endDate: '2026-03-31', isActive: true,
    });
    baseRepo.labExists.mockResolvedValue(false);
    const service = new AdminSeasonService({ repo: baseRepo as never });
    await expect(service.update(5, {
      content: [{ contentType: 'lab', contentId: 404, releaseOrder: 1, isReleased: true }],
    })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('AdminPointsService', () => {
  it('rejects adjustments for unknown users', async () => {
    const repo = { findUser: vi.fn().mockResolvedValue(null) };
    const service = new AdminPointsService({ repo: repo as never, points: {} as never });
    await expect(service.adjust(999, 10, 'test')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records the adjustment and refreshes the leaderboard row', async () => {
    const repo = {
      findUser: vi.fn().mockResolvedValue({ userId: 1 }),
      sumPointsForUser: vi.fn().mockResolvedValue(110),
      countCourseCompletionsForUser: vi.fn().mockResolvedValue(2),
      upsertLeaderboard: vi.fn(),
    };
    const points = { credit: vi.fn().mockResolvedValue({ historyId: 42, newBalance: 110 }) };
    const service = new AdminPointsService({ repo: repo as never, points: points as never });

    const result = await service.adjust(1, 10, 'Correction');

    expect(result).toEqual({ historyId: 42, newBalance: 110 });
    expect(repo.upsertLeaderboard).toHaveBeenCalledWith(1, 110, 2);
  });
});

describe('AdminCertificateService', () => {
  it('invalidates a certificate', async () => {
    const repo = {
      findCertificateById: vi.fn().mockResolvedValue({
        certificateId: 3, certificateNumber: 'DM-2026-abcdef12', courseTitle: 'DevOps',
        grade: '92.5', issuedAt: new Date('2026-01-01T00:00:00Z'), isValid: true,
      }),
      updateCertificateValidity: vi.fn(),
    };
    const service = new AdminCertificateService({ repo: repo as never });
    const cert = await service.invalidate(3);
    expect(cert.isValid).toBe(false);
    expect(repo.updateCertificateValidity).toHaveBeenCalledWith(3, false);
  });

  it('throws when the certificate does not exist', async () => {
    const repo = { findCertificateById: vi.fn().mockResolvedValue(null) };
    const service = new AdminCertificateService({ repo: repo as never });
    await expect(service.invalidate(404)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('LeaderboardComputationJob', () => {
  it('aggregates, ranks, snapshots and recomputes season rows', async () => {
    const repo = {
      sumPointsByUser: vi.fn().mockResolvedValue(new Map([[1, 100], [2, 80]])),
      countCourseCompletionsByUser: vi.fn().mockResolvedValue(new Map([[1, 1], [2, 1]])),
      upsertLeaderboard: vi.fn(),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([
        { leaderboardId: 1, userId: 1, totalPoints: 100 },
        { leaderboardId: 2, userId: 2, totalPoints: 80 },
      ]),
      setGlobalRank: vi.fn(),
      listCountryScopedRows: vi.fn().mockResolvedValue([
        { leaderboardId: 1, userId: 1, countryId: 10 },
        { leaderboardId: 2, userId: 2, countryId: 20 },
      ]),
      setCountryRank: vi.fn(),
      insertHistorySnapshot: vi.fn(),
      listSeasons: vi.fn().mockResolvedValue([
        { seasonId: 1, seasonName: 'S1', seasonNumber: 1, startDate: '2026-01-01', endDate: '2026-03-31', isActive: true },
      ]),
      sumPointsBetweenByUser: vi.fn().mockResolvedValue(new Map([[1, 60], [2, 40]])),
      upsertSeasonLeaderboard: vi.fn(),
      listAllSeasonRows: vi.fn().mockResolvedValue([
        { leaderboardId: 3, userId: 1, pointsEarned: 60 },
        { leaderboardId: 4, userId: 2, pointsEarned: 40 },
      ]),
      setSeasonRank: vi.fn(),
    };
    const job = new LeaderboardComputationJob({ repo: repo as never, intervalMinutes: 15 });

    const result = await job.run();

    expect(result.processedUsers).toBe(2);
    expect(result.snapshotRows).toBe(2);
    expect(repo.upsertLeaderboard).toHaveBeenCalledWith(1, 100, 1);
    expect(repo.upsertLeaderboard).toHaveBeenCalledWith(2, 80, 1);
    expect(repo.setGlobalRank).toHaveBeenNthCalledWith(1, 1, 1);
    expect(repo.setGlobalRank).toHaveBeenNthCalledWith(2, 2, 2);
    expect(repo.setCountryRank).toHaveBeenNthCalledWith(1, 1, 1);
    expect(repo.setCountryRank).toHaveBeenNthCalledWith(2, 2, 1);
    expect(repo.insertHistorySnapshot).toHaveBeenCalledWith([
      { userId: 1, totalPoints: 100, globalRank: 1 },
      { userId: 2, totalPoints: 80, globalRank: 2 },
    ]);
    expect(repo.upsertSeasonLeaderboard).toHaveBeenCalledWith(1, 1, 60);
    expect(repo.upsertSeasonLeaderboard).toHaveBeenCalledWith(1, 2, 40);
    expect(repo.setSeasonRank).toHaveBeenNthCalledWith(1, 3, 1);
    expect(repo.setSeasonRank).toHaveBeenNthCalledWith(2, 4, 2);
  });

  it('skips country ranking for users without a country', async () => {
    const repo = {
      sumPointsByUser: vi.fn().mockResolvedValue(new Map([[1, 10]])),
      countCourseCompletionsByUser: vi.fn().mockResolvedValue(new Map()),
      upsertLeaderboard: vi.fn(),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([{ leaderboardId: 1, userId: 1, totalPoints: 10 }]),
      setGlobalRank: vi.fn(),
      listCountryScopedRows: vi.fn().mockResolvedValue([]),
      setCountryRank: vi.fn(),
      insertHistorySnapshot: vi.fn(),
      listSeasons: vi.fn().mockResolvedValue([]),
    };
    const job = new LeaderboardComputationJob({ repo: repo as never, intervalMinutes: 15 });
    const result = await job.run();
    expect(result.processedUsers).toBe(1);
    expect(repo.setCountryRank).not.toHaveBeenCalled();
  });
});

describe('LeaderboardService', () => {
  it('rejects class leaderboard access for unrelated users (IDOR guard)', async () => {
    const repo = {
      findClass: vi.fn().mockResolvedValue({ classId: 5, className: 'CS-101', organizationId: 1 }),
      getOrgId: vi.fn().mockResolvedValue(99),
      isProfessorOfClass: vi.fn().mockResolvedValue(false),
      listClassStudentIds: vi.fn(),
      getLeaderboardForUsers: vi.fn(),
    };
    const actor = { userId: 3, roles: ['org_student'], permissions: ['gamification:org:read'] };
    const service = new LeaderboardService({ repo: repo as never });

    await expect(service.getClass(5, actor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows the class professor to read the class leaderboard', async () => {
    const repo = {
      findClass: vi.fn().mockResolvedValue({ classId: 5, className: 'CS-101', organizationId: 1 }),
      getOrgId: vi.fn().mockResolvedValue(1),
      isProfessorOfClass: vi.fn().mockResolvedValue(true),
      listClassStudentIds: vi.fn().mockResolvedValue([3, 4]),
      getLeaderboardForUsers: vi.fn().mockResolvedValue([]),
    };
    const actor = { userId: 3, roles: ['professor'], permissions: ['gamification:class:read'] };
    const service = new LeaderboardService({ repo: repo as never });

    const result = await service.getClass(5, actor);

    expect(result.className).toBe('CS-101');
    expect(repo.listClassStudentIds).toHaveBeenCalledWith(5);
  });
});