import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { ProgressService, type ProgressServiceDeps } from '../../../src/features/progress/services/ProgressService';
import { activityLogService } from '../../../src/features/progress/services/ActivityLogService';
import { redisClient } from '../../../src/app/cache/redis';

const platformProgressPermission = 'platform.progress.read';
const TX = { tag: 'tx' };

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 20,
    moduleId: 10,
    courseId: 1,
    title: 'Images and Containers',
    kind: 'lesson' as const,
    position: 1,
    labId: null,
    quizId: null,
    moduleTitle: 'Docker Fundamentals',
    moduleOrder: 1,
    courseTitle: 'Containers',
    ...overrides,
  };
}

function progressRow(overrides: Record<string, unknown> = {}) {
  return {
    progressId: 1,
    userId: 9,
    courseId: 1,
    moduleId: 10,
    lessonId: 20,
    progressPercentage: '0',
    isCompleted: false,
    completedAt: null,
    lastAccessedAt: new Date('2026-02-01T10:00:00.000Z'),
    timeSpentSeconds: 0,
    ...overrides,
  };
}

type Fn = ReturnType<typeof vi.fn>;
type RepoMock = Record<string, Fn>;

function makeRepo(): RepoMock {
  return {
    findPublishedItem: vi.fn(async () => itemRow()),
    findLessonProgress: vi.fn(async () => progressRow()),
    touchLessonProgress: vi.fn(async () => ({ row: progressRow(), created: true })),
    markLessonCompleted: vi.fn(async () => ({
      row: progressRow({ isCompleted: true, progressPercentage: '100', completedAt: new Date('2026-02-01T11:00:00.000Z') }),
      wasCompleted: false,
    })),
    markGrainCompleted: vi.fn(async () => true),
    listNewlyCompletedTracksForCourse: vi.fn(async () => []),
    countPublishedItemsByModule: vi.fn(async () => 5),
    countPublishedItemsByCourse: vi.fn(async () => 10),
    countCompletedItemsByModule: vi.fn(async () => new Map()),
    countCompletedItemsByCourse: vi.fn(async () => 0),
    hasLabCompletedEvent: vi.fn(async () => false),
    hasPassedQuizAttempt: vi.fn(async () => false),
    findPublishedCourse: vi.fn(async () => ({ courseId: 1, title: 'Containers' })),
    findPublishedModule: vi.fn(async () => ({ moduleId: 10, courseId: 1, title: 'Docker Fundamentals', moduleOrder: 1, courseTitle: 'Containers' })),
    listPublishedModulesByCourse: vi.fn(async () => [
      { moduleId: 10, title: 'Docker Fundamentals', moduleOrder: 1, itemCount: 5 },
      { moduleId: 11, title: 'Kubernetes Basics', moduleOrder: 2, itemCount: 5 },
    ]),
    listPublishedItemsByModule: vi.fn(async () => []),
    listLessonProgressByLessonIds: vi.fn(async () => new Map()),
    countPassedLabSteps: vi.fn(async () => new Map()),
    listLabSpecValues: vi.fn(async () => new Map()),
    quizAttemptStats: vi.fn(async () => new Map()),
    getContinueLearningRow: vi.fn(async () => null),
    listStartedCourses: vi.fn(async () => [{ courseId: 1, title: 'Containers', lastAccessedAt: new Date() }]),
    listClassAssignedCourses: vi.fn(async () => [{ courseId: 1, title: 'Containers', lastAccessedAt: null }]),
    listClassStudents: vi.fn(async () => []),
    listOrgStudents: vi.fn(async () => []),
    findFirstAssignedCourseForOrg: vi.fn(async () => 1),
    countCompletedItemsByModuleForUsers: vi.fn(async () => new Map()),
    countCompletedItemsForUsers: vi.fn(async () => new Map()),
    countCompletedModulesForUsers: vi.fn(async () => new Map()),
    lastAccessForUsers: vi.fn(async () => new Map()),
    listUsersActivityDates: vi.fn(async () => new Map()),
    countLabCompletedEvents: vi.fn(async () => new Map()),
    listQuizAttempts: vi.fn(async () => []),
    isProfessorOfClass: vi.fn(async () => true),
    isClassMember: vi.fn(async () => true),
    findClass: vi.fn(async () => ({ organizationId: 5, className: 'DevOps A', teamOwnerId: 1 })),
    findUser: vi.fn(async () => ({
      userId: 7,
      username: 'student',
      email: 'student@example.com',
      fullName: 'Student One',
    })),
  };
}

vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
  cacheKeys: {},
}));

function makeService(repo: RepoMock = makeRepo(), extra: { canAccess?: boolean; role?: string | null } = {}) {
  const award = {
    withUserLock: vi.fn(async (_userId: number, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
    balance: vi.fn(async () => 42),
    apply: vi.fn(async () => undefined),
  };
  const courseAccess = {
    getCourseAccess: vi.fn(async () => (extra.canAccess === false
      ? { canAccess: false, reason: 'premium_required', message: 'Upgrade to continue.' }
      : { canAccess: true, reason: null, message: null })),
  };
  const memberships = { getRoleInOrg: vi.fn(async () => extra.role ?? null) };
  const deps = {
    repo,
    award,
    courseAccess,
    memberships,
    courseCacheTtlSeconds: 60,
    platformProgressPermission,
  } as unknown as ProgressServiceDeps;
  return { service: new ProgressService(deps), repo, award, courseAccess, memberships };
}

describe('ProgressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startLesson', () => {
    it('creates the progress row under the user lock and records LESSON_STARTED once', async () => {
      const { service, repo, award } = makeService();
      const result = await service.startLesson(9, 20);

      expect(award.withUserLock).toHaveBeenCalledWith(9, expect.any(Function));
      expect(repo.touchLessonProgress).toHaveBeenCalledWith(TX, 9, { courseId: 1, moduleId: 10, lessonId: 20 });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(
        9,
        'LESSON_STARTED',
        { lessonId: 20, moduleId: 10, courseId: 1 },
        TX,
      );
      expect(result.lessonId).toBe(20);
    });

    it('is idempotent: a second start touches last_accessed only, no activity', async () => {
      const repo = makeRepo();
      repo.touchLessonProgress.mockResolvedValueOnce({ row: progressRow(), created: false });
      const { service } = makeService(repo);
      await service.startLesson(9, 20);
      expect(activityLogService.recordEvent).not.toHaveBeenCalled();
    });

    it('404s LESSON_NOT_FOUND for unpublished or unknown items', async () => {
      const repo = makeRepo();
      repo.findPublishedItem.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.startLesson(9, 20)).rejects.toMatchObject({
        statusCode: 404,
        errors: [{ code: 'LESSON_NOT_FOUND' }],
      });
    });

    it('403s COURSE_ACCESS_DENIED with the reason when the course is locked', async () => {
      const { service, award } = makeService(makeRepo(), { canAccess: false });
      await expect(service.startLesson(9, 20)).rejects.toMatchObject({
        statusCode: 403,
        errors: [{ code: 'COURSE_ACCESS_DENIED', reason: 'premium_required', message: 'Upgrade to continue.' }],
      });
      expect(award.withUserLock).not.toHaveBeenCalled();
    });
  });

  describe('completeLesson', () => {
    it('rejects completion when the item was never started (409 LESSON_NOT_STARTED)', async () => {
      const repo = makeRepo();
      repo.findLessonProgress.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.completeLesson(9, 20, 120)).rejects.toBeInstanceOf(ConflictError);
      await expect(service.completeLesson(9, 20, 120)).resolves.toBeDefined();
    });

    it('completes a lesson item, logs LESSON_COMPLETED and returns xp delta 0 with the balance', async () => {
      const { service, repo } = makeService();
      const result = await service.completeLesson(9, 20, 300);

      expect(repo.markLessonCompleted).toHaveBeenCalledWith(TX, 9, {
        courseId: 1,
        moduleId: 10,
        lessonId: 20,
        timeSpentSeconds: 300,
      });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(
        9,
        'LESSON_COMPLETED',
        { lessonId: 20, moduleId: 10, courseId: 1, timeSpentSeconds: 300 },
        TX,
      );
      expect(result).toMatchObject({ newlyCompleted: true, moduleNewlyCompleted: false, courseNewlyCompleted: false });
      expect(result.xp).toEqual({ delta: 0, balance: 42 });
      expect(result.lesson.isCompleted).toBe(true);
      expect(redisClient.del).toHaveBeenCalledWith('course_progress:9:1');
    });

    it('logs MODULE_COMPLETED and COURSE_COMPLETED only when the grains are newly completed', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByModule.mockResolvedValue(new Map([[10, 5]]));
      repo.countCompletedItemsByCourse.mockResolvedValue(10);
      const { service } = makeService(repo);
      const result = await service.completeLesson(9, 20, 300);

      expect(result).toMatchObject({ moduleNewlyCompleted: true, courseNewlyCompleted: true });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'MODULE_COMPLETED', { moduleId: 10, courseId: 1 }, TX);
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'COURSE_COMPLETED', { courseId: 1 }, TX);
    });

    it('writes TRACK_COMPLETED on the completing write, once per newly completed track', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByModule.mockResolvedValue(new Map([[10, 5]]));
      repo.countCompletedItemsByCourse.mockResolvedValue(10);
      repo.listNewlyCompletedTracksForCourse.mockResolvedValue([{ trackId: 1, trackName: 'DevOps Engineer' }]);
      const { service } = makeService(repo);
      await service.completeLesson(9, 20, 300);

      expect(repo.listNewlyCompletedTracksForCourse).toHaveBeenCalledWith(TX, 9, 1);
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(
        9,
        'TRACK_COMPLETED',
        expect.objectContaining({ trackId: 1, title: 'DevOps Engineer' }),
        TX,
      );
    });

    it('does not look for track completion unless the course was newly completed', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByCourse.mockResolvedValue(3);
      const { service } = makeService(repo);
      await service.completeLesson(9, 20, 30);
      expect(repo.listNewlyCompletedTracksForCourse).not.toHaveBeenCalled();
      expect(activityLogService.recordEvent).not.toHaveBeenCalledWith(9, 'TRACK_COMPLETED', expect.anything(), expect.anything());
    });

    it('never awards points from lesson, module or course completion', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByModule.mockResolvedValue(new Map([[10, 5]]));
      repo.countCompletedItemsByCourse.mockResolvedValue(10);
      const { service, award } = makeService(repo);
      await service.completeLesson(9, 20, 300);
      expect(award.apply).not.toHaveBeenCalled();
    });

    it('a re-completion reports nothing new and writes no events (D16)', async () => {
      const repo = makeRepo();
      repo.markLessonCompleted.mockResolvedValueOnce({ row: progressRow({ isCompleted: true }), wasCompleted: true });
      const { service } = makeService(repo);
      const result = await service.completeLesson(9, 20, 30);

      expect(result).toMatchObject({ newlyCompleted: false, moduleNewlyCompleted: false, courseNewlyCompleted: false });
      expect(repo.markGrainCompleted).not.toHaveBeenCalled();
      expect(activityLogService.recordEvent).not.toHaveBeenCalled();
    });

    it('refuses a lab item until the lab is completed (409 LAB_NOT_COMPLETED)', async () => {
      const repo = makeRepo();
      repo.findPublishedItem.mockResolvedValue(itemRow({ kind: 'lab', labId: 3 }));
      const { service } = makeService(repo);
      await expect(service.completeLesson(9, 20, 0)).rejects.toMatchObject({
        statusCode: 409,
        errors: [{ code: 'LAB_NOT_COMPLETED' }],
      });
      repo.hasLabCompletedEvent.mockResolvedValueOnce(true);
      await expect(service.completeLesson(9, 20, 0)).resolves.toMatchObject({ newlyCompleted: true });
      expect(repo.hasLabCompletedEvent).toHaveBeenLastCalledWith(9, 3, TX);
    });

    it('refuses a quiz item until the quiz is passed (409 QUIZ_NOT_PASSED)', async () => {
      const repo = makeRepo();
      repo.findPublishedItem.mockResolvedValue(itemRow({ kind: 'quiz', quizId: 4 }));
      const { service } = makeService(repo);
      await expect(service.completeLesson(9, 20, 0)).rejects.toMatchObject({
        errors: [{ code: 'QUIZ_NOT_PASSED' }],
      });
    });
  });

  describe('getCourseProgress', () => {
    it('returns 0% for a fresh user (live count, not hardcoded)', async () => {
      const { service } = makeService();
      const result = await service.getCourseProgress(9, 1);
      expect(result).toMatchObject({ courseId: 1, progressPercentage: 0, totalLessons: 10, completedLessonCount: 0 });
    });

    it('returns 100% when every published item is completed', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByCourse.mockResolvedValueOnce(10);
      const { service } = makeService(repo);
      const result = await service.getCourseProgress(9, 1);
      expect(result.progressPercentage).toBe(100);
      expect(result.isCompleted).toBe(true);
    });

    it('404s COURSE_NOT_FOUND for an unpublished course', async () => {
      const repo = makeRepo();
      repo.findPublishedCourse.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.getCourseProgress(9, 1)).rejects.toMatchObject({ errors: [{ code: 'COURSE_NOT_FOUND' }] });
    });
  });

  describe('getCourseModulesProgress', () => {
    it('computes per-module percentages over published items of all kinds', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByModule.mockResolvedValueOnce(new Map([[10, 5]]));
      const { service } = makeService(repo);
      const result = await service.getCourseModulesProgress(9, 1);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ moduleId: 10, completedLessons: 5, totalLessons: 5, progressPercentage: 100, isCompleted: true });
      expect(result[1]).toMatchObject({ progressPercentage: 0, isCompleted: false });
    });
  });

  describe('getModuleItemsProgress', () => {
    it('reports lab step and quiz attempt progress per item', async () => {
      const repo = makeRepo();
      repo.listPublishedItemsByModule.mockResolvedValueOnce([
        itemRow({ itemId: 20, kind: 'lab', labId: 3 }),
        itemRow({ itemId: 21, kind: 'quiz', quizId: 4 }),
      ]);
      repo.countPassedLabSteps.mockResolvedValueOnce(new Map([[3, 1]]));
      repo.listLabSpecValues.mockResolvedValueOnce(new Map([[3, {
        version: 2, mode: 'guided', scenario: { intro: '', setup: [] }, completionBonus: 50,
        steps: [
          { id: 's1', title: 'One', instructions: 'Do it.', kind: 'task', setup: [], hints: [], points: 25,
            check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 } },
          { id: 's2', title: 'Two', instructions: 'Do it.', kind: 'task', setup: [], hints: [], points: 25,
            check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 } },
        ],
      }]]));
      repo.quizAttemptStats.mockResolvedValueOnce(new Map([[4, { isPassed: true, bestScore: 80, attemptsUsedToday: 2 }]]));
      const { service } = makeService(repo);
      const result = await service.getModuleItemsProgress(9, 10);

      expect(result[0]).toMatchObject({ itemId: 20, kind: 'lab', isStarted: false, lab: { passedSteps: 1, totalSteps: 2 } });
      expect(result[1]).toMatchObject({ itemId: 21, kind: 'quiz', quiz: { isPassed: true, bestScore: 80, attemptsUsedToday: 2 } });
    });

    it('404s for an unpublished module', async () => {
      const repo = makeRepo();
      repo.findPublishedModule.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.getModuleItemsProgress(9, 10)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getContinueLearning', () => {
    it('returns null gracefully when no progress exists (AC-09)', async () => {
      const { service } = makeService();
      expect(await service.getContinueLearning(9)).toBeNull();
    });

    it('returns the last-accessed item with its kind and context', async () => {
      const repo = makeRepo();
      repo.getContinueLearningRow.mockResolvedValueOnce({
        ...itemRow({ kind: 'lab', labId: 3 }),
        lastAccessedAt: new Date('2026-02-01T10:00:00.000Z'),
      });
      repo.countCompletedItemsByCourse.mockResolvedValueOnce(4);
      const { service } = makeService(repo);
      const result = await service.getContinueLearning(9);

      expect(result).toMatchObject({
        lessonId: 20,
        lessonTitle: 'Images and Containers',
        moduleTitle: 'Docker Fundamentals',
        progressPct: 40,
        kind: 'lab',
        labId: 3,
        quizId: null,
      });
    });
  });

  describe('computeStreak (invariant 9)', () => {
    const today = new Date('2026-08-16T12:00:00.000Z');

    it('returns 0 for a user with no activity', () => {
      const { service } = makeService();
      expect(service.computeStreak([], today)).toBe(0);
    });

    it('counts consecutive days ending today', () => {
      const { service } = makeService();
      const days = ['2026-08-16', '2026-08-15', '2026-08-14', '2026-08-13'];
      expect(service.computeStreak(days, today)).toBe(4);
    });

    it('counts a streak ending yesterday as still active', () => {
      const { service } = makeService();
      const days = ['2026-08-15', '2026-08-14', '2026-08-13'];
      expect(service.computeStreak(days, today)).toBe(3);
    });

    it('breaks the streak when the chain is interrupted', () => {
      const { service } = makeService();
      const days = ['2026-08-16', '2026-08-15', '2026-08-13'];
      expect(service.computeStreak(days, today)).toBe(2);
    });

    it('returns 0 when the last activity is older than yesterday', () => {
      const { service } = makeService();
      const days = ['2026-08-10'];
      expect(service.computeStreak(days, today)).toBe(0);
    });
  });

  describe('getClassStudentsProgress (staff scope)', () => {
    it('403s when the caller is neither professor, org admin nor owner of the class', async () => {
      const repo = makeRepo();
      repo.isProfessorOfClass.mockResolvedValueOnce(false);
      const { service } = makeService(repo);
      const actor = { userId: 3, permissions: ['progress.class.read'], roles: ['professor'] };
      await expect(service.getClassStudentsProgress(99, actor)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('lets an org admin of the class organization read it (membership scoping, D15)', async () => {
      const repo = makeRepo();
      repo.isProfessorOfClass.mockResolvedValueOnce(false);
      const { service, memberships } = makeService(repo, { role: 'org_admin' });
      const actor = { userId: 3, permissions: [], roles: [] };
      await expect(service.getClassStudentsProgress(99, actor)).resolves.toBeDefined();
      expect(memberships.getRoleInOrg).toHaveBeenCalledWith(3, 5);
    });

    it('returns the roster for an assigned course with course options', async () => {
      const repo = makeRepo();
      repo.listClassStudents.mockResolvedValueOnce([
        { userId: 7, fullName: 'Student One', email: 'student@example.com', joinedAt: new Date() },
      ]);
      repo.countCompletedItemsByModuleForUsers.mockResolvedValueOnce(new Map([[10, 5]]));
      const { service } = makeService(repo);
      const actor = { userId: 3, permissions: ['progress.class.read'], roles: ['professor'] };
      const result = await service.getClassStudentsProgress(99, actor);

      expect(result.className).toBe('DevOps A');
      expect(result.students).toHaveLength(1);
      expect(result.students[0].userId).toBe(7);
      expect(result.courseOptions).toEqual([{ courseId: 1, title: 'Containers' }]);
      expect(result.moduleAverages[0]).toMatchObject({ moduleId: 10, averageProgressPercentage: 100 });
      expect(result.moduleAverages[1]).toMatchObject({ moduleId: 11, averageProgressPercentage: 0 });
    });

    it('404s COURSE_NOT_FOUND for a course that is not assigned to the class', async () => {
      const { service } = makeService();
      const actor = { userId: 3, permissions: [], roles: ['professor'] };
      await expect(service.getClassStudentsProgress(99, actor, 77)).rejects.toMatchObject({
        errors: [{ code: 'COURSE_NOT_FOUND' }],
      });
    });
  });

  describe('getOrgStudentsProgress (org scope)', () => {
    it('403s when the caller is not an org admin of that org', async () => {
      const { service } = makeService(makeRepo(), { role: 'professor' });
      const actor = { userId: 3, permissions: ['progress.org.read'], roles: ['org_admin'] };
      await expect(service.getOrgStudentsProgress(5, actor)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows the org admin of the org', async () => {
      const repo = makeRepo();
      repo.listOrgStudents.mockResolvedValueOnce([
        { userId: 7, fullName: 'Student One', email: 'student@example.com', joinedAt: new Date(), className: 'DevOps A' },
      ]);
      const { service } = makeService(repo, { role: 'org_admin' });
      const actor = { userId: 3, permissions: ['progress.org.read'], roles: ['org_admin'] };
      const result = await service.getOrgStudentsProgress(5, actor);

      expect(result).toHaveLength(1);
      expect(result[0].className).toBe('DevOps A');
    });
  });

  describe('getAdminUserProgress', () => {
    it('404s for an unknown user', async () => {
      const repo = makeRepo();
      repo.findUser.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.getAdminUserProgress(1234)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the progress of the most recent started course with course options', async () => {
      const repo = makeRepo();
      repo.countCompletedItemsByCourse.mockResolvedValueOnce(6);
      const { service } = makeService(repo);
      const result = await service.getAdminUserProgress(7);

      expect(result.user.username).toBe('student');
      expect(result.course?.completedLessonCount).toBe(6);
      expect(result.modules).toHaveLength(2);
      expect(result.quizAttempts).toEqual([]);
      expect(result.courseOptions).toEqual([{ courseId: 1, title: 'Containers' }]);
    });
  });
});
