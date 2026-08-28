import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { ProgressService, type ProgressServiceDeps } from '../../src/features/progress/services/ProgressService';
import { curriculumService } from '../../src/features/curriculum/services/CurriculumService';
import { activityLogService } from '../../src/features/progress/services/ActivityLogService';

const platformProgressPermission = 'platform.progress.read';

function lessonSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    lessonId: 20,
    moduleId: 10,
    title: 'Images and Containers',
    contentType: 'text' as const,
    lessonOrder: 1,
    isPublished: true,
    ...overrides,
  };
}

function moduleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: 10,
    courseId: 1,
    title: 'Docker Fundamentals',
    moduleOrder: 1,
    estimatedMinutes: 120,
    isPublished: true,
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

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeRepo(): Mocked<ProgressServiceDeps['repo']> {
  return {
    findLessonProgress: vi.fn(async () => progressRow()),
    touchLessonProgress: vi.fn(async () => ({ row: progressRow(), created: true })),
    completeLessonWithRollups: vi.fn(async () => ({
      lesson: progressRow({ isCompleted: true, progressPercentage: '100' }),
      moduleCompleted: false,
      courseCompleted: false,
    })),
    findGrainRow: vi.fn(async () => null),
    countPublishedLessonsByCourse: vi.fn(async () => 10),
    listPublishedModulesByCourse: vi.fn(async () => [
      { moduleId: 10, title: 'Docker Fundamentals', moduleOrder: 1, lessonCount: 5 },
      { moduleId: 11, title: 'Kubernetes Basics', moduleOrder: 2, lessonCount: 5 },
    ]),
    countCompletedLessons: vi.fn(async () => 0),
    countCompletedLessonsByModule: vi.fn(async () => new Map()),
    countCompletedLessonsByModuleForUsers: vi.fn(async () => new Map()),
    countCompletedModules: vi.fn(async () => 0),
    getContinueLearningRow: vi.fn(async () => null),
    recordActivity: vi.fn(async () => undefined),
    listActivity: vi.fn(async () => []),
    listUserActivityDates: vi.fn(async () => []),
    listUsersActivityDates: vi.fn(async () => new Map()),
    countLabCompletedEvents: vi.fn(async () => new Map()),
    countLabCompletedEventsForUser: vi.fn(async () => 0),
    lastActivityDate: vi.fn(async () => null),
    countQuizAttempts: vi.fn(async () => 0),
    countPassedQuizAttempts: vi.fn(async () => 0),
    insertAttemptWithAnswers: vi.fn(async () => 1),
    listQuizAttemptsByQuiz: vi.fn(async () => []),
    listQuizAttempts: vi.fn(async () => []),
    listQuizQuestionsWithAnswers: vi.fn(async () => []),
    isProfessorOfClass: vi.fn(async () => true),
    findClass: vi.fn(async () => ({ organizationId: 5, className: 'DevOps A' })),
    listClassStudents: vi.fn(async () => []),
    listOrgStudents: vi.fn(async () => []),
    getOrgId: vi.fn(async () => 5),
    findUser: vi.fn(async () => ({
      userId: 7,
      username: 'student',
      email: 'student@example.com',
      fullName: 'Student One',
    })),
    getStudentsAggregates: vi.fn(async () => ({
      completedLessons: new Map(),
      completedModules: new Map(),
      lastActive: new Map(),
    })),
  };
}

/** Curriculum service is imported statically; stub its snapshot hooks. */
vi.mock('../../src/features/curriculum/services/CurriculumService', () => ({
  curriculumService: {
    getLessonById: vi.fn(async () => lessonSnapshot()),
    getModuleById: vi.fn(async () => moduleSnapshot()),
    getCourseSnapshot: vi.fn(async () => ({
      courseId: 1,
      title: 'DevOps Mentor',
      totalModules: 2,
      totalLessons: 10,
      totalQuizzes: 2,
    })),
    getQuizById: vi.fn(async () => null),
  },
}));

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../src/app/cache/redis', () => ({
  redisClient: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
  cacheKeys: {
    courseProgress: (userId: number): string => `course_progress:${userId}`,
  },
}));

function makeService(repo = makeRepo()): {
  service: ProgressService;
  repo: Mocked<ProgressServiceDeps['repo']>;
} {
  const deps: ProgressServiceDeps = {
    repo,
    courseCacheTtlSeconds: 60,
    platformProgressPermission,
  };
  return { service: new ProgressService(deps), repo };
}

describe('ProgressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startLesson', () => {
    it('creates the progress row and records LESSON_STARTED once', async () => {
      const { service, repo } = makeService();
      const result = await service.startLesson(9, 20);

      expect(repo.touchLessonProgress).toHaveBeenCalledWith(9, {
        courseId: 1,
        moduleId: 10,
        lessonId: 20,
      });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'LESSON_STARTED', {
        lessonId: 20,
        moduleId: 10,
        courseId: 1,
      });
      expect(result.lessonId).toBe(20);
    });

    it('is idempotent: second start touches last_accessed only, no activity', async () => {
      const repo = makeRepo();
      repo.touchLessonProgress.mockResolvedValueOnce({
        row: progressRow({ lastAccessedAt: new Date('2026-02-02T10:00:00.000Z') }),
        created: false,
      });
      const { service } = makeService(repo);
      await service.startLesson(9, 20);

      expect(repo.touchLessonProgress).toHaveBeenCalledTimes(1);
      expect(activityLogService.recordEvent).not.toHaveBeenCalled();
    });

    it('404s for unpublished lessons', async () => {
      const { service } = makeService();
      vi.mocked(curriculumService.getLessonById).mockResolvedValueOnce(
        lessonSnapshot({ isPublished: false }),
      );
      await expect(service.startLesson(9, 20)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('completeLesson', () => {
    it('rejects completion when the lesson was never started', async () => {
      const repo = makeRepo();
      repo.findLessonProgress.mockResolvedValueOnce(null);
      const { service } = makeService(repo);
      await expect(service.completeLesson(9, 20, 120)).rejects.toBeInstanceOf(ConflictError);
    });

    it('accumulates time and logs LESSON_COMPLETED', async () => {
      const { service, repo } = makeService();
      const result = await service.completeLesson(9, 20, 300);

      expect(repo.completeLessonWithRollups).toHaveBeenCalledWith({
        userId: 9,
        courseId: 1,
        moduleId: 10,
        lessonId: 20,
        timeSpentSeconds: 300,
      });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'LESSON_COMPLETED', {
        lessonId: 20,
        moduleId: 10,
        courseId: 1,
        timeSpentSeconds: 300,
      });
      expect(result.lessonProgress.isCompleted).toBe(true);
    });

    it('logs MODULE_COMPLETED and COURSE_COMPLETED on cascade', async () => {
      const repo = makeRepo();
      repo.completeLessonWithRollups.mockResolvedValueOnce({
        lesson: progressRow({ isCompleted: true, progressPercentage: '100' }),
        moduleCompleted: true,
        courseCompleted: true,
      });
      const { service } = makeService(repo);
      await service.completeLesson(9, 20, 300);

      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'MODULE_COMPLETED', {
        moduleId: 10,
        courseId: 1,
      });
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'COURSE_COMPLETED', {
        courseId: 1,
      });
    });
  });

  describe('getCourseProgress', () => {
    it('returns 0% for a fresh user (live count, not hardcoded)', async () => {
      const { service } = makeService();
      const result = await service.getCourseProgress(9);
      expect(result.progressPercentage).toBe(0);
      expect(result.totalLessons).toBe(10);
      expect(result.completedLessonCount).toBe(0);
    });

    it('returns 100% when every published lesson is completed', async () => {
      const repo = makeRepo();
      repo.countCompletedLessons.mockResolvedValueOnce(10);
      const { service } = makeService(repo);
      const result = await service.getCourseProgress(9);
      expect(result.progressPercentage).toBe(100);
      expect(result.isCompleted).toBe(true);
    });
  });

  describe('getModulesProgress', () => {
    it('computes per-module percentages from completed lesson counts', async () => {
      const repo = makeRepo();
      repo.countCompletedLessonsByModule.mockResolvedValueOnce(new Map([[10, 5]]));
      const { service } = makeService(repo);
      const result = await service.getModulesProgress(9);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        moduleId: 10,
        completedLessons: 5,
        totalLessons: 5,
        progressPercentage: 100,
        isCompleted: true,
      });
      expect(result[1]).toMatchObject({ progressPercentage: 0, isCompleted: false });
    });
  });

  describe('getContinueLearning', () => {
    it('returns null gracefully when no progress exists (AC-09)', async () => {
      const { service } = makeService();
      expect(await service.getContinueLearningPointer(9)).toBeNull();
    });

    it('returns the last-accessed lesson with its context', async () => {
      const repo = makeRepo();
      repo.getContinueLearningRow.mockResolvedValueOnce({
        lessonId: 20,
        moduleId: 10,
        courseId: 1,
        lessonTitle: 'Images and Containers',
        moduleTitle: 'Docker Fundamentals',
        lastAccessedAt: new Date('2026-02-01T10:00:00.000Z'),
      });
      repo.countCompletedLessons.mockResolvedValueOnce(4);
      const { service } = makeService(repo);
      const result = await service.getContinueLearningPointer(9);

      expect(result?.lessonTitle).toBe('Images and Containers');
      expect(result?.moduleTitle).toBe('Docker Fundamentals');
      expect(result?.progressPct).toBe(40);
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

  describe('getClassStudentsProgress (professor scope)', () => {
    it('403s when the professor is not assigned to the class', async () => {
      const repo = makeRepo();
      repo.isProfessorOfClass.mockResolvedValueOnce(false);
      const { service } = makeService(repo);
      const actor = { userId: 3, permissions: ['progress.class.read'], roles: ['professor'] };
      await expect(service.getClassStudentsProgress(99, actor)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('returns the roster for an assigned class', async () => {
      const repo = makeRepo();
      repo.listClassStudents.mockResolvedValueOnce([
        { userId: 7, fullName: 'Student One', email: 'student@example.com', joinedAt: new Date() },
      ]);
      repo.countCompletedLessonsByModuleForUsers.mockResolvedValueOnce(new Map([[10, 5]]));
      const { service } = makeService(repo);
      const actor = { userId: 3, permissions: ['progress.class.read'], roles: ['professor'] };
      const result = await service.getClassStudentsProgress(99, actor);

      expect(result.className).toBe('DevOps A');
      expect(result.students).toHaveLength(1);
      expect(result.students[0].userId).toBe(7);
      expect(result.moduleAverages).toHaveLength(2);
      expect(result.moduleAverages[0]).toMatchObject({
        moduleId: 10,
        moduleTitle: 'Docker Fundamentals',
        averageProgressPercentage: 100,
      });
      expect(result.moduleAverages[1]).toMatchObject({
        moduleId: 11,
        averageProgressPercentage: 0,
      });
    });
  });

  describe('getOrgStudentsProgress (org scope)', () => {
    it('403s when the caller belongs to a different org', async () => {
      const repo = makeRepo();
      repo.getOrgId.mockResolvedValueOnce(99);
      const { service } = makeService(repo);
      const actor = { userId: 3, permissions: ['progress.org.read'], roles: ['org_admin'] };
      await expect(service.getOrgStudentsProgress(5, actor)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows org admin for their own org', async () => {
      const repo = makeRepo();
      repo.listOrgStudents.mockResolvedValueOnce([
        {
          userId: 7,
          fullName: 'Student One',
          email: 'student@example.com',
          joinedAt: new Date(),
          className: 'DevOps A',
        },
      ]);
      const { service } = makeService(repo);
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

    it('returns the full progress view for a known user', async () => {
      const repo = makeRepo();
      repo.countCompletedLessons.mockResolvedValueOnce(6);
      const { service } = makeService(repo);
      const result = await service.getAdminUserProgress(7);

      expect(result.user.username).toBe('student');
      expect(result.course?.completedLessonCount).toBe(6);
      expect(result.modules).toHaveLength(2);
      expect(result.quizAttempts).toEqual([]);
    });
  });
});
