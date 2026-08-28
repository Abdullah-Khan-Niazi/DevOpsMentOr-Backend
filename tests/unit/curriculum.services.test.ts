import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/shared/errors';
import { AdminCurriculumService, type AdminCurriculumServiceDeps } from '../../src/features/curriculum/services/AdminCurriculumService';
import { QuizService, type QuizServiceDeps } from '../../src/features/curriculum/services/QuizService';
import { CurriculumService } from '../../src/features/curriculum/services/CurriculumService';

const actor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 1,
    title: 'DevOps Mentor',
    slug: 'devops-mentor',
    description: null,
    difficultyId: 1,
    difficultyName: 'Intermediate',
    categoryId: null,
    categoryName: null,
    instructorId: 1,
    instructorName: 'Admin',
    coverImageUrl: null,
    videoTrailerUrl: null,
    estimatedHours: 40,
    totalLessons: 0,
    totalQuizzes: 0,
    isPublished: true,
    prerequisites: null,
    learningObjectives: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function moduleRow(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: 10,
    courseId: 1,
    title: 'Docker Fundamentals',
    description: null,
    moduleOrder: 1,
    estimatedMinutes: 120,
    isPublished: false,
    lessonCount: 0,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    lessonId: 20,
    moduleId: 10,
    title: 'Images and Containers',
    content: null,
    contentType: 'text' as const,
    videoUrl: null,
    videoDurationSeconds: null,
    lessonOrder: 1,
    isPublished: false,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    ...overrides,
  };
}

function quizRow(overrides: Record<string, unknown> = {}) {
  return {
    quizId: 30,
    moduleId: 10,
    title: 'Docker Quiz',
    description: null,
    passingScore: 70,
    timeLimitMinutes: null,
    isRequired: true,
    isPublished: false,
    createdAt: new Date('2026-01-04T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeRepo(): Mocked<AdminCurriculumServiceDeps['repo']> {
  return {
    getCanonicalCourse: vi.fn(async () => courseRow()),
    createCourse: vi.fn(async () => 1),
    updateCourse: vi.fn(async () => undefined),
    refreshCourseCounts: vi.fn(async () => undefined),
    findModuleById: vi.fn(async () => moduleRow()),
    listModulesAll: vi.fn(async () => []),
    listModulesPublished: vi.fn(async () => []),
    createModule: vi.fn(async () => 11),
    updateModule: vi.fn(async () => undefined),
    setModulePublished: vi.fn(async () => undefined),
    findModuleOrder: vi.fn(async () => null),
    maxModuleOrder: vi.fn(async () => null),
    countModulesByCourse: vi.fn(async () => 3),
    bulkUpdateModuleOrders: vi.fn(async () => undefined),
    findLessonById: vi.fn(async () => lessonRow()),
    listLessonsByModule: vi.fn(async () => []),
    listPublishedLessonsByModule: vi.fn(async () => []),
    createLesson: vi.fn(async () => 21),
    updateLesson: vi.fn(async () => undefined),
    setLessonPublished: vi.fn(async () => undefined),
    findLessonOrder: vi.fn(async () => null),
    maxLessonOrder: vi.fn(async () => null),
    bulkUpdateLessonOrders: vi.fn(async () => undefined),
    archiveModuleCascade: vi.fn(async () => undefined),
    countPublishedLessonsByCourse: vi.fn(async () => 0),
    findQuizById: vi.fn(async () => quizRow()),
    listQuizzesByModule: vi.fn(async () => []),
    listPublishedQuizzesByModule: vi.fn(async () => []),
    createQuiz: vi.fn(async () => 31),
    updateQuiz: vi.fn(async () => undefined),
    setQuizPublished: vi.fn(async () => undefined),
    countQuestionsByQuiz: vi.fn(async () => 0),
    findQuestionById: vi.fn(async () => null),
    listQuestionsByQuiz: vi.fn(async () => []),
    createQuestion: vi.fn(async () => 41),
    updateQuestion: vi.fn(async () => undefined),
    listAnswersByQuestion: vi.fn(async () => []),
    replaceAnswers: vi.fn(async () => undefined),
    listTags: vi.fn(async () => []),
    findTagsByIds: vi.fn(async () => []),
    listLessonTags: vi.fn(async () => []),
    setLessonTags: vi.fn(async () => undefined),
  };
}

function makeAdminService(overrides: Partial<Mocked<AdminCurriculumServiceDeps['repo']>> = {}) {
  const repo = { ...makeRepo(), ...overrides };
  const deps: AdminCurriculumServiceDeps = {
    repo,
    quiz: { getQuizAdminDetailForModule: vi.fn(async () => []) } as unknown as QuizService,
    audit: { record: vi.fn(async () => undefined) } as unknown as AdminCurriculumServiceDeps['audit'],
  };
  return { service: new AdminCurriculumService(deps), repo, audit: deps.audit };
}

function makeQuizService() {
  const repo = makeRepo();
  const audit = { record: vi.fn(async () => undefined) };
  const deps: QuizServiceDeps = { repo, audit };
  return { service: new QuizService(deps), repo, audit };
}

describe('AdminCurriculumService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createModule', () => {
    it('creates a module under the canonical course and audits', async () => {
      const { service, repo, audit } = makeAdminService();
      const result = await service.createModule(actor, {
        title: 'Kubernetes Basics',
        moduleOrder: 1,
      });
      expect(repo.createModule).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 1, title: 'Kubernetes Basics' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_module', adminUserId: 9, targetType: 'module' }),
      );
      expect(result.title).toBe('Docker Fundamentals');
    });

    it('rejects duplicate module order (invariant 2)', async () => {
      const { service } = makeAdminService({ findModuleOrder: vi.fn(async () => 42) });
      await expect(
        service.createModule(actor, { title: 'Duplicate Order', moduleOrder: 1 }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('updateModule', () => {
    it('rejects an order collision with another module', async () => {
      const { service } = makeAdminService({ findModuleOrder: vi.fn(async () => 7) });
      await expect(
        service.updateModule(actor, 10, { moduleOrder: 5 }),
      ).rejects.toThrow(ConflictError);
    });

    it('allows keeping the current order', async () => {
      const { service } = makeAdminService({ findModuleOrder: vi.fn(async () => 10) });
      await expect(service.updateModule(actor, 10, { moduleOrder: 1 })).resolves.toBeDefined();
    });
  });

  describe('publishModule', () => {
    it('publishes, refreshes counts and audits', async () => {
      const { service, repo, audit } = makeAdminService();
      await service.publishModule(actor, 10);
      expect(repo.setModulePublished).toHaveBeenCalledWith(10, true);
      expect(repo.refreshCourseCounts).toHaveBeenCalledWith(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish_module', targetId: 10 }),
      );
    });
  });

  describe('archiveModule', () => {
    it('cascades is_published=FALSE to lessons and quizzes atomically (AC-03)', async () => {
      const { service, repo, audit } = makeAdminService();
      await service.archiveModule(actor, 10);
      expect(repo.archiveModuleCascade).toHaveBeenCalledWith(10);
      expect(repo.setModulePublished).not.toHaveBeenCalled();
      expect(repo.refreshCourseCounts).toHaveBeenCalledWith(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'archive_module', targetId: 10 }),
      );
    });
  });

  describe('reorderModules', () => {
    it('rejects duplicate order values in the input array', async () => {
      const { service } = makeAdminService();
      await expect(
        service.reorderModules(actor, [
          { moduleId: 10, moduleOrder: 1 },
          { moduleId: 11, moduleOrder: 1 },
        ]),
      ).rejects.toThrow(ConflictError);
      expect(makeRepo().bulkUpdateModuleOrders).not.toHaveBeenCalled();
    });

    it('rejects modules outside the canonical course', async () => {
      const { service } = makeAdminService({ findModuleById: vi.fn(async () => moduleRow({ courseId: 99 })) });
      await expect(
        service.reorderModules(actor, [{ moduleId: 10, moduleOrder: 1 }]),
      ).rejects.toThrow(NotFoundError);
    });

    it('performs a transactional bulk update for valid orders', async () => {
      const { service, repo } = makeAdminService();
      await service.reorderModules(actor, [
        { moduleId: 10, moduleOrder: 2 },
        { moduleId: 11, moduleOrder: 1 },
      ]);
      expect(repo.bulkUpdateModuleOrders).toHaveBeenCalledWith([
        { moduleId: 10, moduleOrder: 2 },
        { moduleId: 11, moduleOrder: 1 },
      ]);
    });
  });

  describe('publishLesson', () => {
    it('blocks publishing a lesson under an unpublished module (rule 4)', async () => {
      const { service } = makeAdminService();
      await expect(service.publishLesson(actor, 20)).rejects.toThrow(ConflictError);
    });

    it('publishes when the parent module is published', async () => {
      const { service, repo, audit } = makeAdminService({
        findModuleById: vi.fn(async () => moduleRow({ isPublished: true })),
      });
      await service.publishLesson(actor, 20);
      expect(repo.setLessonPublished).toHaveBeenCalledWith(20, true);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'publish_lesson', targetId: 20 }),
      );
    });
  });

  describe('reorderLessons', () => {
    it('rejects a lesson that does not belong to the module', async () => {
      const { service } = makeAdminService({
        listLessonsByModule: vi.fn(async () => [lessonRow()]),
      });
      await expect(
        service.reorderLessons(actor, 10, [{ lessonId: 999, lessonOrder: 1 }]),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects duplicate lesson orders', async () => {
      const { service } = makeAdminService({
        listLessonsByModule: vi.fn(async () => [lessonRow(), lessonRow({ lessonId: 21 })]),
      });
      await expect(
        service.reorderLessons(actor, 10, [
          { lessonId: 20, lessonOrder: 1 },
          { lessonId: 21, lessonOrder: 1 },
        ]),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('createLesson', () => {
    it('creates a draft lesson and applies tags', async () => {
      const { service, repo } = makeAdminService({ findTagsByIds: vi.fn(async () => [5]) });
      const result = await service.createLesson(actor, 10, {
        title: 'Networking 101',
        contentType: 'video',
        videoUrl: 'https://cdn.example.com/v.mp4',
        videoDurationSeconds: 300,
        lessonOrder: 1,
        tagIds: [5],
      });
      expect(repo.createLesson).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleId: 10,
          title: 'Networking 101',
          contentType: 'video',
        }),
      );
      expect(repo.setLessonTags).toHaveBeenCalledWith(21, [5]);
      expect(result.title).toBe('Images and Containers');
    });

    it('rejects a duplicate lesson order', async () => {
      const { service } = makeAdminService({ findLessonOrder: vi.fn(async () => 3) });
      await expect(
        service.createLesson(actor, 10, { title: 'Duplicate', lessonOrder: 1 }),
      ).rejects.toThrow(ConflictError);
    });

    it('rejects unknown tag ids', async () => {
      const { service } = makeAdminService({ findTagsByIds: vi.fn(async () => []) });
      await expect(
        service.createLesson(actor, 10, { title: 'Bad Tags', lessonOrder: 1, tagIds: [5] }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe('QuizService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertAnswerInvariant (rule 6)', () => {
    const service = new QuizService({ repo: makeRepo(), audit: { record: vi.fn() } });

    it('requires exactly one correct answer for multiple_choice', () => {
      expect(() =>
        service.assertAnswerInvariant('multiple_choice', [
          { answerText: 'A', isCorrect: false, answerOrder: 1 },
          { answerText: 'B', isCorrect: true, answerOrder: 2 },
        ]),
      ).not.toThrow();
      expect(() =>
        service.assertAnswerInvariant('multiple_choice', [
          { answerText: 'A', isCorrect: false, answerOrder: 1 },
          { answerText: 'B', isCorrect: false, answerOrder: 2 },
        ]),
      ).toThrow(ValidationError);
      expect(() =>
        service.assertAnswerInvariant('multiple_choice', [
          { answerText: 'A', isCorrect: true, answerOrder: 1 },
          { answerText: 'B', isCorrect: true, answerOrder: 2 },
        ]),
      ).toThrow(ValidationError);
    });

    it('requires exactly one correct answer for true_false', () => {
      expect(() =>
        service.assertAnswerInvariant('true_false', [
          { answerText: 'True', isCorrect: true, answerOrder: 1 },
          { answerText: 'False', isCorrect: false, answerOrder: 2 },
        ]),
      ).not.toThrow();
      expect(() =>
        service.assertAnswerInvariant('true_false', [
          { answerText: 'True', isCorrect: false, answerOrder: 1 },
          { answerText: 'False', isCorrect: false, answerOrder: 2 },
        ]),
      ).toThrow(ValidationError);
    });

    it('requires at least one correct answer for multiple_select', () => {
      expect(() =>
        service.assertAnswerInvariant('multiple_select', [
          { answerText: 'A', isCorrect: true, answerOrder: 1 },
          { answerText: 'B', isCorrect: true, answerOrder: 2 },
        ]),
      ).not.toThrow();
      expect(() =>
        service.assertAnswerInvariant('multiple_select', [
          { answerText: 'A', isCorrect: false, answerOrder: 1 },
          { answerText: 'B', isCorrect: false, answerOrder: 2 },
        ]),
      ).toThrow(ValidationError);
    });
  });

  describe('createQuiz', () => {
    it('defaults is_published to the parent module state (rule 4)', async () => {
      const { service, repo } = makeQuizService();
      await service.createQuiz(actor, 10, {
        title: 'Docker Quiz',
        passingScore: 70,
        timeLimitMinutes: null,
        isRequired: true,
      });
      expect(repo.createQuiz).toHaveBeenCalledWith(expect.objectContaining({ isPublished: false }));
    });

    it('creates published when the module is published', async () => {
      const { service, repo } = makeQuizService();
      repo.findModuleById.mockImplementation(async () => moduleRow({ isPublished: true }));
      await service.createQuiz(actor, 10, {
        title: 'Docker Quiz',
        passingScore: 70,
        timeLimitMinutes: null,
        isRequired: true,
      });
      expect(repo.createQuiz).toHaveBeenCalledWith(expect.objectContaining({ isPublished: true }));
    });
  });

  describe('updateQuiz', () => {
    it('rejects publishing a quiz under a draft module (rule 4)', async () => {
      const { service, repo } = makeQuizService();
      repo.findQuizById.mockImplementation(async () => quizRow({ isPublished: false }));
      repo.findModuleById.mockImplementation(async () => moduleRow({ isPublished: false }));
      await expect(
        service.updateQuiz(actor, 30, { isPublished: true }),
      ).rejects.toThrow(ConflictError);
      expect(repo.updateQuiz).not.toHaveBeenCalled();
    });

    it('allows publishing a quiz under a published module', async () => {
      const { service, repo } = makeQuizService();
      repo.findQuizById.mockImplementation(async () => quizRow({ isPublished: false }));
      repo.findModuleById.mockImplementation(async () => moduleRow({ isPublished: true }));
      await service.updateQuiz(actor, 30, { isPublished: true });
      expect(repo.updateQuiz).toHaveBeenCalledWith(30, expect.objectContaining({ isPublished: true }));
    });
  });

  describe('createQuestion', () => {
    it('rejects answers that violate the invariant before persisting', async () => {
      const { service, repo } = makeQuizService();
      repo.findQuizById.mockImplementation(async () => quizRow({ isPublished: true }));
      await expect(
        service.createQuestion(actor, 30, {
          questionText: 'Which is correct?',
          questionType: 'multiple_choice',
          points: 10,
          explanation: null,
          questionOrder: 1,
          answers: [
            { answerText: 'A', isCorrect: false, answerOrder: 1 },
            { answerText: 'B', isCorrect: false, answerOrder: 2 },
          ],
        }),
      ).rejects.toThrow(ValidationError);
      expect(repo.createQuestion).not.toHaveBeenCalled();
    });
  });

  describe('stripCorrectAnswers (AC-04)', () => {
    it('removes is_correct from every answer', () => {
      const { service } = makeQuizService();
      const stripped = service.stripCorrectAnswers({
        questionId: 41,
        quizId: 30,
        questionText: 'Q',
        questionType: 'multiple_choice',
        points: 10,
        explanation: null,
        questionOrder: 1,
        isActive: true,
        answers: [
          { answerId: 51, questionId: 41, answerText: 'A', isCorrect: true, answerOrder: 1 },
          { answerId: 52, questionId: 41, answerText: 'B', isCorrect: false, answerOrder: 2 },
        ],
      });
      expect(stripped.answers).toHaveLength(2);
      for (const answer of stripped.answers) {
        expect(answer).not.toHaveProperty('isCorrect');
      }
      expect(stripped.answers[0]).toEqual({
        answerId: 51,
        questionId: 41,
        answerText: 'A',
        answerOrder: 1,
      });
    });
  });
});

describe('CurriculumService (learner read path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for a DRAFT lesson (AC-07)', async () => {
    const repo = makeRepo();
    repo.findLessonById.mockImplementation(async () => lessonRow({ isPublished: false }));
    const service = new CurriculumService({ repo });
    await expect(service.getPublishedLesson(20)).rejects.toThrow(NotFoundError);
  });

  it('returns the lesson when published', async () => {
    const repo = makeRepo();
    repo.findLessonById.mockImplementation(async () => lessonRow({ isPublished: true }));
    repo.listLessonTags.mockImplementation(async () => [{ tagId: 5, tagName: 'docker' }]);
    const service = new CurriculumService({ repo });
    const lesson = await service.getPublishedLesson(20);
    expect(lesson.title).toBe('Images and Containers');
    expect(lesson.tags).toEqual([{ tagId: 5, tagName: 'docker' }]);
  });

  it('exposes course snapshots for F5/F6 consumption', async () => {
    const repo = makeRepo();
    repo.getCanonicalCourse.mockImplementation(async () =>
      courseRow({ totalLessons: 12, totalQuizzes: 3 }),
    );
    repo.countModulesByCourse.mockImplementation(async () => 4);
    const service = new CurriculumService({ repo });
    const snapshot = await service.getCourseSnapshot();
    expect(snapshot).toEqual({
      courseId: 1,
      title: 'DevOps Mentor',
      totalModules: 4,
      totalLessons: 12,
      totalQuizzes: 3,
    });
  });
});
