import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../src/shared/errors';
import { AdminCurriculumService, type AdminCurriculumServiceDeps } from '../../../src/features/curriculum/services/AdminCurriculumService';
import {
  CurriculumService,
  moduleSlidesUrl,
  type CurriculumServiceDeps,
} from '../../../src/features/curriculum/services/CurriculumService';

const configEnv = vi.hoisted(() => ({ SLIDES_PUBLIC_BASE_URL: 'http://localhost:5050/assets' }));

vi.mock('../../../src/app/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/app/config')>();
  return { ...actual, env: new Proxy(actual.env, {
    get: (target, prop) => (prop === 'SLIDES_PUBLIC_BASE_URL' ? configEnv.SLIDES_PUBLIC_BASE_URL : Reflect.get(target, prop)),
  }) };
});
vi.mock('../../../src/app/database', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tag: 'tx' })) },
}));
vi.mock('../../../src/features/curriculum/services/curriculum-slug.service', () => ({
  curriculumSlugService: { recomputeCourse: vi.fn(async () => undefined) },
}));

type Fn = ReturnType<typeof vi.fn>;

const learner = { userId: 7, ipAddress: '127.0.0.1', userAgent: 'vitest', roles: [] };
const admin = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

const validSpec = {
  version: 2, mode: 'guided', scenario: { intro: '', setup: [] }, completionBonus: 50,
  steps: [
    { id: 's1', title: 'a', instructions: 'a', kind: 'task', setup: [], check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } }, hints: [], points: 25 },
    { id: 's2', title: 'b', instructions: 'b', kind: 'task', setup: [], check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } }, hints: [], points: 25 },
  ],
};

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 1, title: 'Linux', slug: 'C01', description: null, difficultyId: 1, difficultyName: 'Beginner',
    categoryId: null, categoryName: null, instructorId: 1, instructorName: 'Admin', coverImageUrl: null,
    videoTrailerUrl: null, estimatedHours: 4, totalLessons: 3, totalQuizzes: 1, isPublished: true, isPremium: false,
    prerequisites: null, learningObjectives: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function moduleRow(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: 10, courseId: 1, title: 'Basics', description: null, moduleOrder: 1, slug: 'C01M01',
    estimatedMinutes: 60, isPublished: true, lessonCount: 2,
    createdAt: new Date('2026-01-02T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 20, moduleId: 10, position: 1, kind: 'lesson', title: 'Intro', slug: 'C01M01L01', contentType: 'text',
    videoDurationSeconds: null, isPublished: true, labId: null, quizId: null, lab: null, quiz: null, ...overrides,
  };
}

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    lessonId: 20, moduleId: 10, title: 'Intro', slug: 'C01M01L01', content: 'Body', contentType: 'text',
    videoUrl: null, videoDurationSeconds: null, lessonOrder: 1, isPublished: true, labId: null, quizId: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'), updatedAt: new Date('2026-01-03T00:00:00.000Z'), ...overrides,
  };
}

const labItem = (overrides: Record<string, unknown> = {}, flagValues: unknown = validSpec) => itemRow({
  itemId: 21, kind: 'lab', labId: 5, contentType: 'lab',
  lab: { labId: 5, slug: 'C01M01L02', labName: 'Linux Lab', difficultyName: 'Easy', estimatedHours: 1, isPremium: false, isActive: true, flagValues },
  ...overrides,
});

const quizItem = (overrides: Record<string, unknown> = {}) => itemRow({
  itemId: 22, kind: 'quiz', quizId: 31, contentType: 'quiz',
  quiz: { quizId: 31, activeQuestionCount: 4, passingScore: 70, timeLimitMinutes: null, isRequired: true, isPublished: true },
  ...overrides,
});

function makeRepo(): Record<string, Fn> {
  return {
    listPublishedCourses: vi.fn(async () => [courseRow()]),
    findCourseById: vi.fn(async () => courseRow()),
    listModules: vi.fn(async () => [moduleRow()]),
    findModuleById: vi.fn(async () => moduleRow()),
    listItemsByModule: vi.fn(async () => [itemRow()]),
    findItemById: vi.fn(async () => itemRow()),
    findLessonById: vi.fn(async () => lessonRow()),
    listLessonTags: vi.fn(async () => []),
    countModulesByCourse: vi.fn(async () => 3),
    findQuizById: vi.fn(async () => null),
  };
}

function makeService(repoOverrides: Record<string, Fn> = {}, canAccess = true) {
  const repo = { ...makeRepo(), ...repoOverrides };
  const access = {
    getCourseAccess: vi.fn(async () => (canAccess
      ? { canAccess: true, reason: 'free', message: null }
      : { canAccess: false, reason: 'premium_required', message: 'Upgrade to access this course.' })),
  };
  const service = new CurriculumService({ repo, access } as unknown as CurriculumServiceDeps);
  return { service, repo, access };
}

describe('CurriculumService learner reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configEnv.SLIDES_PUBLIC_BASE_URL = 'http://localhost:5050/assets';
  });

  it('has no canonical-course API any more', () => {
    const { service } = makeService();
    expect((service as unknown as Record<string, unknown>).getCourse).toBeUndefined();
  });

  it('lists published courses with module and visible item counts', async () => {
    const { service, repo } = makeService({ listModules: vi.fn(async () => [moduleRow({ lessonCount: 2 }), moduleRow({ moduleId: 11, lessonCount: 3 })]) });
    const courses = await service.listCourses();
    expect(repo.listModules).toHaveBeenCalledWith(1, { publishedOnly: true });
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ courseId: 1, slug: 'C01', moduleCount: 2, itemCount: 5, isPremium: false });
  });

  it('reads modules course-scoped, published only, in order', async () => {
    const { service, repo } = makeService();
    const modules = await service.listCourseModules(1);
    expect(repo.listModules).toHaveBeenCalledWith(1, { publishedOnly: true });
    expect(modules.map((m) => m.slug)).toEqual(['C01M01']);
  });

  it('returns 200 outline with the access state when the learner has access', async () => {
    const { service } = makeService();
    const detail = await service.getCourseDetail(learner, 1);
    expect(detail.access).toMatchObject({ canAccess: true });
    expect(detail.modules).toHaveLength(1);
  });

  it('returns the outline (200) with canAccess=false and the reason when locked', async () => {
    const { service } = makeService({}, false);
    const detail = await service.getCourseDetail(learner, 1);
    expect(detail.access).toMatchObject({ canAccess: false, reason: 'premium_required' });
    expect(detail.modules).toHaveLength(1);
  });

  it('404s an unpublished or missing course on every outline read', async () => {
    const { service } = makeService({ findCourseById: vi.fn(async () => courseRow({ isPublished: false })) });
    await expect(service.getCourseDetail(learner, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.listCourseModules(1)).rejects.toBeInstanceOf(NotFoundError);
    const missing = makeService({ findCourseById: vi.fn(async () => null) });
    await expect(missing.service.getCourseDetail(learner, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s a module that is a draft or whose course is unpublished', async () => {
    const draft = makeService({ findModuleById: vi.fn(async () => moduleRow({ isPublished: false })) });
    await expect(draft.service.getModule(10)).rejects.toBeInstanceOf(NotFoundError);
    await expect(draft.service.listModuleItems(10)).rejects.toBeInstanceOf(NotFoundError);
    const hiddenCourse = makeService({ findCourseById: vi.fn(async () => courseRow({ isPublished: false })) });
    await expect(hiddenCourse.service.getModule(10)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists only learner-visible items via the repo filter', async () => {
    const { service, repo } = makeService();
    await service.listModuleItems(10);
    expect(repo.listItemsByModule).toHaveBeenCalledWith(10, { publishedOnly: true });
  });

  describe('items DTO', () => {
    it('maps a lab item with its step count and never exposes the spec', async () => {
      const { service } = makeService({ listItemsByModule: vi.fn(async () => [labItem()]) });
      const [item] = await service.listModuleItems(10);
      expect(item.kind).toBe('lab');
      expect(item.lab).toMatchObject({ labId: 5, stepCount: 2 });
      expect(JSON.stringify(item)).not.toMatch(/flagValues|check|instructions|command/);
    });

    it('reports stepCount 0 for a lab that is not ready (missing, legacy or invalid spec)', async () => {
      for (const flagValues of [null, { cp1: 'docker' }, { version: 2, steps: [] }]) {
        const { service } = makeService({ listItemsByModule: vi.fn(async () => [labItem({}, flagValues)]) });
        const [item] = await service.listModuleItems(10);
        expect(item.lab?.stepCount).toBe(0);
      }
    });

    it('maps a quiz item with its question count and omits a NULL lab_id lab object', async () => {
      const { service } = makeService({ listItemsByModule: vi.fn(async () => [quizItem(), itemRow()]) });
      const [quiz, lesson] = await service.listModuleItems(10);
      expect(quiz.quiz).toMatchObject({ quizId: 31, questionCount: 4, passingScore: 70 });
      expect(quiz.lab).toBeNull();
      expect(lesson.lab).toBeNull();
      expect(lesson.quiz).toBeNull();
    });
  });

  describe('getLesson', () => {
    it('returns the lesson with the module slug and slidesUrl when entitled', async () => {
      const { service } = makeService();
      const lesson = await service.getLesson(learner, 20);
      expect(lesson).toMatchObject({ lessonId: 20, courseId: 1, content: 'Body', kind: 'lesson', moduleSlug: 'C01M01' });
      expect(lesson.slidesUrl).toBe('http://localhost:5050/assets/slides/C01M01.pdf');
    });

    it('403 COURSE_ACCESS_DENIED with the reason when not entitled', async () => {
      const { service } = makeService({}, false);
      const error = await service.getLesson(learner, 20).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).errors?.[0]).toMatchObject({ code: 'COURSE_ACCESS_DENIED', reason: 'premium_required' });
    });

    it('404s before the access check for unpublished content, never 403', async () => {
      const cases: Array<Record<string, Fn>> = [
        { findItemById: vi.fn(async () => itemRow({ isPublished: false })) },
        { findItemById: vi.fn(async () => labItem({}, validSpec)) , findModuleById: vi.fn(async () => moduleRow({ isPublished: false })) },
        { findItemById: vi.fn(async () => quizItem({ quiz: { quizId: 31, activeQuestionCount: 1, passingScore: 70, timeLimitMinutes: null, isRequired: true, isPublished: false } })) },
        { findItemById: vi.fn(async () => null) },
      ];
      for (const overrides of cases) {
        const { service, access } = makeService(overrides, false);
        await expect(service.getLesson(learner, 20)).rejects.toBeInstanceOf(NotFoundError);
        expect(access.getCourseAccess).not.toHaveBeenCalled();
      }
    });

    it('404s a lab item whose lab is inactive', async () => {
      const row = labItem();
      (row.lab as { isActive: boolean }).isActive = false;
      const { service } = makeService({ findItemById: vi.fn(async () => row) });
      await expect(service.getLesson(learner, 21)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('carries no content for lab and quiz items', async () => {
      const { service } = makeService({
        findItemById: vi.fn(async () => labItem()),
        findLessonById: vi.fn(async () => lessonRow({ contentType: 'lab', labId: 5, content: 'secret' })),
      });
      const lesson = await service.getLesson(learner, 21);
      expect(lesson.kind).toBe('lab');
      expect(lesson.content).toBeNull();
      expect(lesson.labId).toBe(5);
    });
  });

  describe('snapshots', () => {
    it('getCourseSnapshot is course-scoped and 404s an unknown course', async () => {
      const { service, repo } = makeService();
      await expect(service.getCourseSnapshot(1)).resolves.toMatchObject({ courseId: 1, totalModules: 3, totalLessons: 3, totalQuizzes: 1 });
      expect(repo.findCourseById).toHaveBeenCalledWith(1);
      const missing = makeService({ findCourseById: vi.fn(async () => null) });
      await expect(missing.service.getCourseSnapshot(404)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe('moduleSlidesUrl', () => {
  beforeEach(() => {
    configEnv.SLIDES_PUBLIC_BASE_URL = 'http://localhost:5050/assets';
  });

  it('builds the URL from SLIDES_PUBLIC_BASE_URL and the module slug', () => {
    expect(moduleSlidesUrl('C02M03')).toBe('http://localhost:5050/assets/slides/C02M03.pdf');
  });

  it('is null when the base URL is empty or the module has no slug', () => {
    expect(moduleSlidesUrl(null)).toBeNull();
    configEnv.SLIDES_PUBLIC_BASE_URL = '';
    expect(moduleSlidesUrl('C02M03')).toBeNull();
  });
});

describe('AdminCurriculumService modules (course-scoped)', () => {
  function makeAdmin(overrides: Record<string, Fn> = {}) {
    const repo = {
      findCourseById: vi.fn(async () => courseRow()),
      findModuleById: vi.fn(async () => moduleRow()),
      listModules: vi.fn(async () => [moduleRow({ moduleId: 1, moduleOrder: 1 }), moduleRow({ moduleId: 2, moduleOrder: 2 })]),
      maxModuleOrder: vi.fn(async () => 2),
      findModuleOrder: vi.fn(async () => null),
      createModule: vi.fn(async () => 11),
      bulkUpdateModuleOrders: vi.fn(async () => undefined),
      hasModuleLearnerData: vi.fn(async () => false),
      deleteModule: vi.fn(async () => undefined),
      refreshCourseCounts: vi.fn(async () => undefined),
      ...overrides,
    };
    const audit = { record: vi.fn(async () => undefined) };
    return { service: new AdminCurriculumService({ repo, audit } as unknown as AdminCurriculumServiceDeps), repo };
  }

  it('appends a module at max+1 inside the course', async () => {
    const { service, repo } = makeAdmin();
    await service.createModule(admin, 1, { title: 'Networking' });
    expect(repo.createModule).toHaveBeenCalledWith(expect.objectContaining({ courseId: 1, moduleOrder: 3 }), expect.anything());
  });

  it('409s when an explicit module order is taken and 422s past 99 modules', async () => {
    const taken = makeAdmin({ findModuleOrder: vi.fn(async () => 5) });
    await expect(taken.service.createModule(admin, 1, { title: 'Dup order', moduleOrder: 2 })).rejects.toBeInstanceOf(ConflictError);
    const full = makeAdmin({ maxModuleOrder: vi.fn(async () => 99) });
    await expect(full.service.createModule(admin, 1, { title: 'Too many' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('reorders modules only with the exact set', async () => {
    const { service, repo } = makeAdmin();
    await service.reorderModules(admin, 1, [2, 1]);
    expect(repo.bulkUpdateModuleOrders).toHaveBeenCalledWith(
      [{ moduleId: 2, moduleOrder: 1 }, { moduleId: 1, moduleOrder: 2 }],
      expect.anything(),
    );
    await expect(service.reorderModules(admin, 1, [1])).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to delete a module with learner data', async () => {
    const { service, repo } = makeAdmin({ hasModuleLearnerData: vi.fn(async () => true) });
    await expect(service.deleteModule(admin, 10)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.deleteModule).not.toHaveBeenCalled();
  });
});
