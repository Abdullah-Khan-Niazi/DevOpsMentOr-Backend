import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnerProgressSnapshot } from '../../../src/features/gamification/dto/gamification.dto';
import { achievementEvaluator } from '../../../src/features/gamification/engines/achievement-evaluator.engine';
import { BadgeAwardEngine } from '../../../src/features/gamification/engines/badge-award.engine';
import { GamificationEventHandler } from '../../../src/features/gamification/handlers/gamification-event.handler';
import { LeaderboardComputationJob } from '../../../src/features/gamification/jobs/leaderboard-computation.job';
import { AdminAchievementService } from '../../../src/features/gamification/services/admin-achievement.service';
import { AdminBadgeService } from '../../../src/features/gamification/services/admin-badge.service';
import { AdminCertificateService } from '../../../src/features/gamification/services/admin-certificate.service';
import { AdminPointsService } from '../../../src/features/gamification/services/admin-points.service';
import { AdminSeasonService } from '../../../src/features/gamification/services/admin-season.service';
import { CertificateService } from '../../../src/features/gamification/services/certificate.service';
import { GamificationService } from '../../../src/features/gamification/services/gamification.service';
import { LeaderboardService } from '../../../src/features/gamification/services/leaderboard.service';
import { PointsService } from '../../../src/features/gamification/services/points.service';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';

const snapshot: LearnerProgressSnapshot = {
  userId: 1,
  completedCourseIds: [2],
  completedCourseCount: 1,
  completedModuleIds: [4, 5],
  completedModuleCount: 2,
  completedLessonCount: 10,
  completedLabCount: 5,
  quizPassCount: 3,
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  currentStreakDays: 7,
  courseProgressPct: 100,
  pointsBalance: 120,
};

describe('AchievementEvaluator', () => {
  const context = { pointsBalance: 120 };
  const evaluate = (triggerType: string | null, triggerValue: Record<string, unknown> | null, value = snapshot) =>
    achievementEvaluator.evaluate(value, { triggerType, triggerValue }, context).unlocked;

  it('unlocks when completed labs reach the threshold', () => {
    expect(evaluate('lab_completions', { count: 5 })).toBe(true);
    expect(evaluate('lab_completions', { count: 6 })).toBe(false);
  });

  it('unlocks course completion achievements from the completed course count', () => {
    const none: LearnerProgressSnapshot = { ...snapshot, completedCourseIds: [], completedCourseCount: 0, courseProgressPct: 99 };
    expect(evaluate('course_completions', { count: 1 }, none)).toBe(false);
    expect(evaluate('course_completions', { count: 1 })).toBe(true);
  });

  it('evaluates streak_days against the current streak', () => {
    expect(evaluate('streak_days', { count: 7 })).toBe(true);
    expect(evaluate('streak_days', { count: 8 })).toBe(false);
  });

  it('evaluates points_balance against the running balance', () => {
    expect(evaluate('points_balance', { balance: 100 })).toBe(true);
    expect(evaluate('points_balance', { balance: 121 })).toBe(false);
  });

  it('module_complete unlocks only for a completed module id', () => {
    expect(evaluate('module_complete', { moduleId: 4 })).toBe(true);
    expect(evaluate('module_complete', { moduleId: 9 })).toBe(false);
  });

  it('course_complete unlocks only for a completed course id', () => {
    expect(evaluate('course_complete', { courseId: 2 })).toBe(true);
    expect(evaluate('course_complete', { courseId: 3 })).toBe(false);
  });

  it('lab_complete_count compares the completed lab count', () => {
    expect(evaluate('lab_complete_count', { count: 5 })).toBe(true);
    expect(evaluate('lab_complete_count', { count: 6 })).toBe(false);
  });

  it('quiz_pass_count compares the number of passed quizzes', () => {
    expect(evaluate('quiz_pass_count', { count: 3 })).toBe(true);
    expect(evaluate('quiz_pass_count', { count: 4 })).toBe(false);
  });

  it('treats invalid trigger_value shapes as not met', () => {
    expect(evaluate('lab_completions', null)).toBe(false);
    expect(evaluate('lab_complete_count', { count: 0 })).toBe(false);
    expect(evaluate('lab_complete_count', { count: 'many' })).toBe(false);
    expect(evaluate('lab_complete_count', { count: 1.5 })).toBe(false);
    expect(evaluate('module_complete', { moduleId: 'abc' })).toBe(false);
    expect(evaluate('module_complete', {})).toBe(false);
    expect(evaluate('course_complete', { courseId: -2 })).toBe(false);
    expect(evaluate('points_balance', null)).toBe(false);
  });

  it('never unlocks unknown or null trigger types', () => {
    expect(evaluate(null, null)).toBe(false);
    expect(evaluate('unknown_trigger', null)).toBe(false);
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
  const context = { pointsBalance: 0, unlockedAchievementIds: new Set<number>() };

  it('matches course_complete badges with a courseId only when that course is completed', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, award: {} as never });
    const hit = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'course_complete', triggerValue: { courseId: 2 } } }), context);
    expect(hit.matched).toBe(true);
    const miss = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'course_complete', triggerValue: { courseId: 3 } } }), context);
    expect(miss.matched).toBe(false);
  });

  it('matches any completed course when the course_complete trigger has no courseId', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, award: {} as never });
    const hit = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'course_complete', triggerValue: {} } }), context);
    expect(hit.matched).toBe(true);
    const none: LearnerProgressSnapshot = { ...snapshot, completedCourseIds: [], completedCourseCount: 0 };
    expect(engine.evaluate(none, badge({ criteria: { triggerType: 'course_complete', triggerValue: {} } }), context).matched).toBe(false);
  });

  it('matches lab_complete badges by completed lab count', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, award: {} as never });
    const result = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'lab_complete', triggerValue: { count: 5 } } }), context);
    expect(result.matched).toBe(true);
  });

  it('never auto-awards manual badges', () => {
    const engine = new BadgeAwardEngine({ repo: {} as never, award: {} as never });
    const result = engine.evaluate(snapshot, badge({ criteria: { triggerType: 'manual', triggerValue: {} } }), context);
    expect(result.matched).toBe(false);
  });

  /** Award units run against a fake tx; the user lock is modelled by the mock itself. */
  const makeAward = () => ({
    withUserLock: vi.fn(async (_userId: number, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
    apply: vi.fn().mockResolvedValue({ applied: true, historyId: 1, pointsChange: 50, balance: 50 }),
  });

  it('awards each badge once through a locked unit that writes the reward via the ledger key', async () => {
    const repo = {
      listBadgesWithCriteria: vi.fn().mockResolvedValue([
        badge({ criteria: { triggerType: 'lab_complete', triggerValue: { count: 5 } } }),
      ]),
      hasUserBadge: vi.fn().mockResolvedValue(false),
      insertUserBadge: vi.fn().mockResolvedValue(undefined),
    };
    const award = makeAward();
    const engine = new BadgeAwardEngine({ repo: repo as never, award: award as never });

    const events = await engine.evaluateAndAward(1, snapshot, context);

    expect(events).toHaveLength(1);
    expect(events[0].badgeName).toBe('Test Badge');
    expect(award.withUserLock).toHaveBeenCalledWith(1, expect.any(Function));
    expect(repo.insertUserBadge).toHaveBeenCalledWith(1, 1, 'Completed 5+ labs.', { tx: true });
    expect(award.apply).toHaveBeenCalledWith({ tx: true }, {
      userId: 1,
      key: 'badge:1',
      points: 50,
      sourceType: 'achievement',
      sourceId: 1,
      label: 'Badge awarded: Test Badge',
    });

    repo.hasUserBadge.mockResolvedValue(true);
    const again = await engine.evaluateAndAward(1, snapshot, context);
    expect(again).toHaveLength(0);
    expect(repo.insertUserBadge).toHaveBeenCalledTimes(1);
    expect(award.apply).toHaveBeenCalledTimes(1);
  });

  it('rolls back a duplicate-key unit without writing the reward', async () => {
    const repo = {
      listBadgesWithCriteria: vi.fn().mockResolvedValue([
        badge({ criteria: { triggerType: 'lab_complete', triggerValue: { count: 5 } } }),
      ]),
      hasUserBadge: vi.fn().mockResolvedValue(false),
      insertUserBadge: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })),
    };
    const award = makeAward();
    const engine = new BadgeAwardEngine({ repo: repo as never, award: award as never });

    const events = await engine.evaluateAndAward(1, snapshot, context);

    expect(events).toHaveLength(0);
    expect(award.apply).not.toHaveBeenCalled();
  });
});

describe('PointsService', () => {
  it('getBalance delegates to the repository', async () => {
    const repo = { getBalance: vi.fn().mockResolvedValue({ balance: 120, totalEarned: 300 }) };
    const service = new PointsService({ repo: repo as never, awards: {} as never });
    await expect(service.getBalance(1)).resolves.toEqual({ balance: 120, totalEarned: 300 });
  });

  it('credit writes one keyed admin ledger row through awardService', async () => {
    const awards = {
      applyLocked: vi.fn().mockResolvedValue({ applied: true, historyId: 9, pointsChange: 10, balance: 60 }),
    };
    const service = new PointsService({ repo: {} as never, awards });
    const result = await service.credit(1, 10, 'admin_adjustment', null, 'Manual adjustment');
    expect(result).toEqual({ historyId: 9, newBalance: 60 });
    expect(awards.applyLocked).toHaveBeenCalledWith({
      userId: 1,
      key: expect.stringMatching(/^admin:[0-9a-f-]{36}$/),
      points: 10,
      sourceType: 'admin_adjustment',
      sourceId: null,
      label: 'Manual adjustment',
    });
  });

  it('credit of 0 writes nothing and reports a null historyId', async () => {
    const awards = {
      applyLocked: vi.fn().mockResolvedValue({ applied: false, historyId: null, pointsChange: 0, balance: 60 }),
    };
    const service = new PointsService({ repo: {} as never, awards });
    await expect(service.credit(1, 0, 'admin_adjustment')).resolves.toEqual({ historyId: null, newBalance: 60 });
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
          description: '[k:achievement:7] Achievement unlocked: First Lab',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }, {
          historyId: 2,
          pointsChange: 3,
          pointsBalanceAfter: 0,
          sourceType: 'lab_complete',
          sourceId: 1,
          description: 'Old unkeyed row',
          createdAt: new Date('2025-12-31T00:00:00Z'),
        }],
        total: 2,
      }),
    };
    const service = new PointsService({ repo: repo as never, awards: {} as never });
    const history = await service.getHistory(1, 1, 25);
    expect(history.items[0]).toMatchObject({
      historyId: 3,
      pointsChange: 5,
      sourceType: 'achievement',
      sourceId: 7,
      kind: 'achievement',
      description: 'Achievement unlocked: First Lab',
    });
    expect(history.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(history.items[1]).toMatchObject({ kind: 'legacy', description: 'Old unkeyed row' });
  });
});

describe('CertificateService', () => {
  const repo = {
    isCourseCompleted: vi.fn(),
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

  it('rejects issuance before the course-grain progress row is completed (D32)', async () => {
    repo.isCourseCompleted.mockResolvedValue(false);
    repo.listRequiredQuizIds.mockResolvedValue([1]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(1);
    const service = new CertificateService(deps);
    await expect(service.issueCertificate(1, 2)).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.isCourseCompleted).toHaveBeenCalledWith(1, 2);
  });

  it('rejects issuance while a required quiz is not passed by this user', async () => {
    repo.isCourseCompleted.mockResolvedValue(true);
    repo.listRequiredQuizIds.mockResolvedValue([1, 2]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(1);
    const service = new CertificateService(deps);
    await expect(service.issueCertificate(1, 2)).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.countPassedRequiredQuizzes).toHaveBeenCalledWith(1, [1, 2]);
  });

  it('issues a certificate idempotently with the user-scoped graded average (D14)', async () => {
    repo.isCourseCompleted.mockResolvedValue(true);
    repo.listRequiredQuizIds.mockResolvedValue([1, 2]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(2);
    repo.findCertificateByUserCourse.mockResolvedValue(null);
    repo.getGradeData.mockResolvedValue({ scoreSum: 185, quizCount: 2 });
    repo.insertCertificate.mockResolvedValue(11);

    const service = new CertificateService(deps);
    const cert = await service.issueCertificate(1, 2);

    expect(cert.grade).toBe(92.5);
    expect(repo.getGradeData).toHaveBeenCalledWith(1, 2);
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
    repo.isCourseCompleted.mockResolvedValue(true);
    repo.listRequiredQuizIds.mockResolvedValue([]);
    repo.countPassedRequiredQuizzes.mockResolvedValue(0);
    repo.findCertificateByUserCourse.mockResolvedValue(null);
    repo.getGradeData.mockResolvedValue({ scoreSum: 0, quizCount: 0 });
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
  };
  const evaluator = { evaluate: vi.fn() };
  const badges = { evaluateAndAward: vi.fn().mockResolvedValue([]) };
  const award = {
    withUserLock: vi.fn(async (_userId: number, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
    apply: vi.fn().mockResolvedValue({ applied: true, historyId: 1, pointsChange: 20, balance: 20 }),
  };

  const service = new GamificationEventHandler({
    repo: repo as never,
    evaluator: evaluator as never,
    badges: badges as never,
    award: award as never,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unlocks achievements in a locked unit, credits points through the ledger key, then evaluates badges', async () => {
    repo.listActiveAchievements.mockResolvedValue([
      { achievementId: 1, name: 'First Lab', pointsAwarded: 20, triggerType: 'lab_complete_count', triggerValue: { count: 1 }, isActive: true },
    ]);
    evaluator.evaluate.mockReturnValue({ unlocked: true, progressData: { completedLabCount: 5 } });
    repo.hasUserAchievement.mockResolvedValue(false);
    repo.getBalance.mockResolvedValueOnce({ balance: 0, totalEarned: 0 }).mockResolvedValueOnce({ balance: 20, totalEarned: 20 });

    const result = await service.handleProgressSnapshot(snapshot);

    expect(award.withUserLock).toHaveBeenCalledWith(1, expect.any(Function));
    expect(repo.insertUserAchievement).toHaveBeenCalledWith(1, 1, { completedLabCount: 5 }, { tx: true });
    expect(award.apply).toHaveBeenCalledWith({ tx: true }, {
      userId: 1,
      key: 'achievement:1',
      points: 20,
      sourceType: 'achievement',
      sourceId: 1,
      label: 'Achievement unlocked: First Lab',
    });
    expect(badges.evaluateAndAward).toHaveBeenCalledWith(1, snapshot, { pointsBalance: 20, unlockedAchievementIds: new Set([1]) });
    expect(result.achievementsUnlocked).toHaveLength(1);
    expect(result.certificateIssued).toBe(false);
    expect(result.certificateCourseIds).toEqual([]);
  });

  it('skips an achievement whose user_achievements row already exists inside the unit', async () => {
    repo.listActiveAchievements.mockResolvedValue([
      { achievementId: 1, name: 'First Lab', pointsAwarded: 20, triggerType: 'lab_complete_count', triggerValue: { count: 1 }, isActive: true },
    ]);
    evaluator.evaluate.mockReturnValue({ unlocked: true, progressData: {} });
    repo.hasUserAchievement.mockResolvedValue(true);

    const result = await service.handleProgressSnapshot(snapshot);

    expect(result.achievementsUnlocked).toHaveLength(0);
    expect(repo.insertUserAchievement).not.toHaveBeenCalled();
    expect(award.apply).not.toHaveBeenCalled();
  });

  it('rolls back a duplicate-key unit and continues with the next achievement', async () => {
    repo.listActiveAchievements.mockResolvedValue([
      { achievementId: 1, name: 'First Lab', pointsAwarded: 20, triggerType: 'lab_complete_count', triggerValue: { count: 1 }, isActive: true },
      { achievementId: 2, name: 'Module One', pointsAwarded: 30, triggerType: 'module_complete', triggerValue: { moduleId: 4 }, isActive: true },
    ]);
    evaluator.evaluate.mockReturnValue({ unlocked: true, progressData: {} });
    repo.hasUserAchievement.mockResolvedValue(false);
    repo.insertUserAchievement
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
      .mockResolvedValueOnce(undefined);

    const result = await service.handleProgressSnapshot(snapshot);

    expect(result.achievementsUnlocked.map((event) => event.achievementId)).toEqual([2]);
    expect(award.apply).toHaveBeenCalledTimes(1);
    expect(award.apply).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({ key: 'achievement:2', points: 30 }));
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
      leaderboard: { getGamificationSummary: vi.fn(), refreshUserTotals: vi.fn() } as never,
      certificates: { issueCertificate: vi.fn() } as never,
    });

    const profile = await service.getMyProfile(1);

    expect(profile.points).toEqual({ balance: 40, totalEarned: 90 });
    expect(profile.globalRank).toBe(3);
    expect(profile.countryRank).toBe(1);
    expect(profile.currentStreakDays).toBe(2);
    expect(profile.badges[0]).toMatchObject({ badgeId: 1, badgeName: 'First Lab' });
  });

  it('returns the top-bar summary without badge or achievement lists', async () => {
    const repo = {
      getBalance: vi.fn().mockResolvedValue({ balance: 40, totalEarned: 90 }),
      findLeaderboardForUser: vi.fn().mockResolvedValue({ globalRank: 3, countryRank: null }),
      listUserActivityDates: vi.fn().mockResolvedValue(['2026-01-01']),
    };
    const service = new GamificationService({
      repo: repo as never,
      progress: { computeStreak: vi.fn().mockReturnValue(4) } as never,
      handler: {} as never,
      leaderboard: {} as never,
      certificates: {} as never,
    });

    await expect(service.getMeSummary(1)).resolves.toEqual({
      balance: 40,
      totalEarned: 90,
      globalRank: 3,
      currentStreakDays: 4,
    });
  });
});

describe('GamificationService.afterLearningEvent', () => {
  /** In-memory stand-ins for the user_achievements table and the locked ledger unit. */
  function harness(options: { completedCourseIds: number[]; certificateFails?: number[] }) {
    const unlocked = new Set<number>();
    const issued: number[] = [];
    const repo = {
      getBalance: vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
      getLearnerSnapshot: vi.fn().mockResolvedValue({
        ...snapshot,
        completedCourseIds: options.completedCourseIds,
        completedCourseCount: options.completedCourseIds.length,
      }),
      listActiveAchievements: vi.fn().mockResolvedValue([
        { achievementId: 1, name: 'First Lab', pointsAwarded: 20, triggerType: 'lab_complete_count', triggerValue: { count: 1 }, isActive: true },
      ]),
      hasUserAchievement: vi.fn(async (_userId: number, achievementId: number) => unlocked.has(achievementId)),
      insertUserAchievement: vi.fn(async (_userId: number, achievementId: number) => {
        unlocked.add(achievementId);
      }),
      listUnlockedAchievementIds: vi.fn(async () => [...unlocked]),
      findCertificateByUserCourse: vi.fn().mockResolvedValue(null),
    };
    const award = {
      withUserLock: vi.fn(async (_userId: number, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
      apply: vi.fn().mockResolvedValue({ applied: true, historyId: 1, pointsChange: 20, balance: 20 }),
    };
    const badges = { evaluateAndAward: vi.fn().mockResolvedValue([]) };
    const certificates = {
      issueCertificate: vi.fn(async (_userId: number, courseId: number) => {
        if (options.certificateFails?.includes(courseId)) {
          throw new Error('certificate boom');
        }
        issued.push(courseId);
        return {};
      }),
    };
    const leaderboard = {
      refreshUserTotals: vi.fn().mockResolvedValue({ totalPoints: 20, courseCompletionsCount: 0 }),
      getGamificationSummary: vi.fn(),
    };
    const handler = new GamificationEventHandler({
      repo: repo as never,
      evaluator: achievementEvaluator,
      badges: badges as never,
      award: award as never,
    });
    const service = new GamificationService({
      repo: repo as never,
      progress: { computeStreak: vi.fn() } as never,
      handler,
      leaderboard: leaderboard as never,
      certificates: certificates as never,
    });
    return { service, repo, award, certificates, leaderboard, issued };
  }

  it('awards an achievement once: a second call writes no second ledger row', async () => {
    const { service, award } = harness({ completedCourseIds: [] });

    const first = await service.afterLearningEvent(1);
    const second = await service.afterLearningEvent(1);

    expect(first.achievementsUnlocked).toHaveLength(1);
    expect(second.achievementsUnlocked).toHaveLength(0);
    expect(award.apply).toHaveBeenCalledTimes(1);
    expect(award.apply).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({ key: 'achievement:1' }));
  });

  it('issues certificates for completed courses without one and refreshes leaderboard totals last', async () => {
    const { service, repo, certificates, leaderboard, issued } = harness({ completedCourseIds: [2, 3] });
    repo.findCertificateByUserCourse.mockImplementation(async (_userId: number, courseId: number) =>
      courseId === 3 ? { certificateId: 9 } : null,
    );

    const result = await service.afterLearningEvent(1);

    expect(certificates.issueCertificate).toHaveBeenCalledTimes(1);
    expect(certificates.issueCertificate).toHaveBeenCalledWith(1, 2);
    expect(issued).toEqual([2]);
    expect(result.certificateIssued).toBe(true);
    expect(result.certificateCourseIds).toEqual([2]);
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledWith(1);
    expect(leaderboard.refreshUserTotals.mock.invocationCallOrder[0]).toBeGreaterThan(
      certificates.issueCertificate.mock.invocationCallOrder[0],
    );
  });

  it('a certificate failure for one course does not stop the other courses', async () => {
    const { service, certificates, leaderboard } = harness({ completedCourseIds: [2, 3, 4], certificateFails: [2] });

    const result = await service.afterLearningEvent(1);

    expect(certificates.issueCertificate.mock.calls.map((call) => call[1])).toEqual([2, 3, 4]);
    expect(result.certificateCourseIds).toEqual([3, 4]);
    expect(result.certificateIssued).toBe(true);
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledWith(1);
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
    const service = new AdminPointsService({ repo: repo as never, points: {} as never, leaderboard: {} as never });
    await expect(service.adjust(999, 10, 'test')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records the adjustment and refreshes the leaderboard totals', async () => {
    const repo = { findUser: vi.fn().mockResolvedValue({ userId: 1 }) };
    const points = { credit: vi.fn().mockResolvedValue({ historyId: 42, newBalance: 110 }) };
    const leaderboard = { refreshUserTotals: vi.fn().mockResolvedValue({ totalPoints: 110, courseCompletionsCount: 2 }) };
    const service = new AdminPointsService({ repo: repo as never, points: points as never, leaderboard });

    const result = await service.adjust(1, 10, 'Correction');

    expect(result).toEqual({ historyId: 42, newBalance: 110 });
    expect(points.credit).toHaveBeenCalledWith(1, 10, 'admin_adjustment', null, 'Correction');
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledWith(1);
    expect(points.credit.mock.invocationCallOrder[0]).toBeLessThan(
      leaderboard.refreshUserTotals.mock.invocationCallOrder[0],
    );
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
  it('refreshes totals, ranks, snapshots and recomputes season rows', async () => {
    const repo = {
      listLeaderboardCandidateUserIds: vi.fn().mockResolvedValue([1, 2]),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([
        { leaderboardId: 1, userId: 1, totalPoints: 100, globalRank: null },
        { leaderboardId: 2, userId: 2, totalPoints: 80, globalRank: null },
      ]),
      setGlobalRank: vi.fn(),
      listCountryScopedRows: vi.fn().mockResolvedValue([
        { leaderboardId: 1, userId: 1, countryId: 10, totalPoints: 100, countryRank: null },
        { leaderboardId: 2, userId: 2, countryId: 20, totalPoints: 80, countryRank: null },
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
    const leaderboard = { refreshUserTotals: vi.fn().mockResolvedValue({ totalPoints: 0, courseCompletionsCount: 0 }) };
    const job = new LeaderboardComputationJob({ repo: repo as never, leaderboard, intervalMinutes: 15 });

    const result = await job.run();

    expect(result.processedUsers).toBe(2);
    expect(result.snapshotRows).toBe(2);
    expect(result.failedUsers).toBe(0);
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledWith(1);
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledWith(2);
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
      listLeaderboardCandidateUserIds: vi.fn().mockResolvedValue([1]),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([{ leaderboardId: 1, userId: 1, totalPoints: 10, globalRank: 1 }]),
      setGlobalRank: vi.fn(),
      listCountryScopedRows: vi.fn().mockResolvedValue([]),
      setCountryRank: vi.fn(),
      insertHistorySnapshot: vi.fn(),
      listSeasons: vi.fn().mockResolvedValue([]),
    };
    const leaderboard = { refreshUserTotals: vi.fn().mockResolvedValue({ totalPoints: 10, courseCompletionsCount: 0 }) };
    const job = new LeaderboardComputationJob({ repo: repo as never, leaderboard, intervalMinutes: 15 });
    const result = await job.run();
    expect(result.processedUsers).toBe(1);
    expect(repo.setCountryRank).not.toHaveBeenCalled();
    // Unchanged rank: no write.
    expect(repo.setGlobalRank).not.toHaveBeenCalled();
  });

  it('shares ranks on ties and keeps going when one user refresh fails', async () => {
    const repo = {
      listLeaderboardCandidateUserIds: vi.fn().mockResolvedValue([1, 2, 3]),
      listAllLeaderboardRows: vi.fn().mockResolvedValue([
        { leaderboardId: 1, userId: 1, totalPoints: 50, globalRank: null },
        { leaderboardId: 2, userId: 2, totalPoints: 50, globalRank: null },
        { leaderboardId: 3, userId: 3, totalPoints: 10, globalRank: null },
      ]),
      setGlobalRank: vi.fn(),
      listCountryScopedRows: vi.fn().mockResolvedValue([]),
      setCountryRank: vi.fn(),
      insertHistorySnapshot: vi.fn(),
      listSeasons: vi.fn().mockResolvedValue([]),
    };
    const leaderboard = {
      refreshUserTotals: vi.fn()
        .mockResolvedValueOnce({ totalPoints: 50, courseCompletionsCount: 0 })
        .mockRejectedValueOnce(new Error('lock wait timeout'))
        .mockResolvedValueOnce({ totalPoints: 10, courseCompletionsCount: 0 }),
    };
    const job = new LeaderboardComputationJob({ repo: repo as never, leaderboard, intervalMinutes: 15 });
    const result = await job.run();
    expect(result.failedUsers).toBe(1);
    expect(leaderboard.refreshUserTotals).toHaveBeenCalledTimes(3);
    expect(repo.setGlobalRank).toHaveBeenNthCalledWith(1, 1, 1);
    expect(repo.setGlobalRank).toHaveBeenNthCalledWith(2, 2, 1);
    expect(repo.setGlobalRank).toHaveBeenNthCalledWith(3, 3, 3);
  });
});

describe('LeaderboardService', () => {
  it('rejects class leaderboard access for unrelated users (IDOR guard)', async () => {
    const repo = {
      findClass: vi.fn().mockResolvedValue({ classId: 5, className: 'CS-101', organizationId: 1 }),
      isProfessorOfClass: vi.fn().mockResolvedValue(false),
      listClassStudentIds: vi.fn(),
      getLeaderboardForUsers: vi.fn(),
    };
    const memberships = { getRoleInOrg: vi.fn().mockResolvedValue('org_student') };
    const actor = { userId: 3, roles: ['org_student'], permissions: ['gamification:org:read'] };
    const service = new LeaderboardService({ repo: repo as never, memberships, award: {} as never });

    await expect(service.getClass(5, actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(memberships.getRoleInOrg).toHaveBeenCalledWith(3, 1);
    expect(repo.listClassStudentIds).not.toHaveBeenCalled();
  });

  it('rejects an org admin of ANOTHER organization (multi-org, D15)', async () => {
    const repo = {
      findClass: vi.fn().mockResolvedValue({ classId: 5, className: 'CS-101', organizationId: 1 }),
      isProfessorOfClass: vi.fn().mockResolvedValue(false),
      listClassStudentIds: vi.fn(),
      getLeaderboardForUsers: vi.fn(),
    };
    // Admin elsewhere, no role in org 1.
    const memberships = { getRoleInOrg: vi.fn().mockResolvedValue(null) };
    const actor = { userId: 8, roles: ['org_admin'], permissions: ['gamification:org:read'] };
    const service = new LeaderboardService({ repo: repo as never, memberships, award: {} as never });

    await expect(service.getClass(5, actor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows the class professor to read the class leaderboard', async () => {
    const repo = {
      findClass: vi.fn().mockResolvedValue({ classId: 5, className: 'CS-101', organizationId: 1 }),
      isProfessorOfClass: vi.fn().mockResolvedValue(true),
      listClassStudentIds: vi.fn().mockResolvedValue([3, 4]),
      getLeaderboardForUsers: vi.fn().mockResolvedValue([]),
    };
    const memberships = { getRoleInOrg: vi.fn() };
    const actor = { userId: 3, roles: ['professor'], permissions: ['gamification:class:read'] };
    const service = new LeaderboardService({ repo: repo as never, memberships, award: {} as never });

    const result = await service.getClass(5, actor);

    expect(result.className).toBe('CS-101');
    expect(repo.listClassStudentIds).toHaveBeenCalledWith(5);
  });
});