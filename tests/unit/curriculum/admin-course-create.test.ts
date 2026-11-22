import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import { AdminCurriculumService } from '../../../src/features/curriculum/services/AdminCurriculumService';
import type { AdminCurriculumServiceDeps } from '../../../src/features/curriculum/services/AdminCurriculumService';
import { createCourseSchema, updateCourseSchema } from '../../../src/features/curriculum/validators/curriculum.validator';

vi.mock('../../../src/app/database', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tag: 'tx' })) },
}));
vi.mock('../../../src/features/curriculum/services/curriculum-slug.service', () => ({
  curriculumSlugService: { recomputeCourse: vi.fn(async () => undefined) },
}));

type Fn = ReturnType<typeof vi.fn>;
type Mocked<T> = { [K in keyof T]: Fn };

const actor = { userId: 1, ipAddress: '127.0.0.1', userAgent: 'vitest' };

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 16, title: 'Advanced Kubernetes Operations', slug: 'C03', description: null,
    difficultyId: 2, difficultyName: 'Intermediate', categoryId: null, categoryName: null,
    instructorId: 1, instructorName: 'Admin', coverImageUrl: null, videoTrailerUrl: null,
    estimatedHours: 12, totalLessons: 0, totalQuizzes: 0, isPublished: false, isPremium: false,
    prerequisites: null, learningObjectives: null,
    createdAt: new Date('2026-11-05T00:00:00.000Z'), updatedAt: new Date('2026-11-05T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDeps(): Mocked<AdminCurriculumServiceDeps> {
  return {
    repo: {
      createCourse: vi.fn(async () => 16),
      updateCourse: vi.fn(async () => undefined),
      findCourseById: vi.fn(async () => courseRow()),
      findCourseBySlug: vi.fn(async () => null),
      nextAvailableCourseSlug: vi.fn(async () => 'C03'),
      listModules: vi.fn(async () => [{ moduleId: 1, isPublished: true }]),
      listDifficultyLevels: vi.fn(async () => [{ difficultyId: 2, name: 'Intermediate' }]),
      listCategories: vi.fn(async () => [{ categoryId: 5, name: 'Containers & Orchestration', slug: 'containers-orchestration' }]),
    },
    audit: { record: vi.fn(async () => undefined) },
  } as unknown as Mocked<AdminCurriculumServiceDeps>;
}

describe('AdminCurriculumService.createCourse', () => {
  let deps: Mocked<AdminCurriculumServiceDeps>;
  let service: AdminCurriculumService;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    service = new AdminCurriculumService(deps);
  });

  it('defaults the slug to the lowest unused Cxx, creates a draft and audits', async () => {
    const course = await service.createCourse(actor, { title: 'Advanced Kubernetes Operations', difficultyId: 2, estimatedHours: 12 });
    expect(deps.repo.nextAvailableCourseSlug).toHaveBeenCalled();
    expect(deps.repo.createCourse).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'C03', isPublished: false, isPremium: false, instructorId: 1 }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_course', targetId: 16 }));
    expect(course.isPublished).toBe(false);
  });

  it('uses an explicit slug without asking for the next free one', async () => {
    await service.createCourse(actor, { title: 'Advanced Kubernetes Operations', slug: 'C42', difficultyId: 2 });
    expect(deps.repo.nextAvailableCourseSlug).not.toHaveBeenCalled();
    expect(deps.repo.createCourse).toHaveBeenCalledWith(expect.objectContaining({ slug: 'C42' }));
  });

  it('409s SLUG_TAKEN when the explicit slug is in use', async () => {
    deps.repo.findCourseBySlug.mockResolvedValue(courseRow() as never);
    await expect(service.createCourse(actor, { title: 'Another course', slug: 'C03', difficultyId: 2 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'SLUG_TAKEN' }] });
    expect(deps.repo.createCourse).not.toHaveBeenCalled();
  });

  it('409s SLUG_TAKEN on a duplicate-key race at insert time', async () => {
    deps.repo.createCourse.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
    await expect(service.createCourse(actor, { title: 'Advanced Kubernetes Operations', difficultyId: 2 }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('409s when every code from C01 to C99 is used', async () => {
    deps.repo.nextAvailableCourseSlug.mockResolvedValue(null as never);
    await expect(service.createCourse(actor, { title: 'One too many', difficultyId: 2 })).rejects.toBeInstanceOf(ConflictError);
    expect(deps.repo.createCourse).not.toHaveBeenCalled();
  });

  it('rethrows unexpected insert errors', async () => {
    deps.repo.createCourse.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.createCourse(actor, { title: 'Advanced Kubernetes Operations', difficultyId: 2 }))
      .rejects.toThrow('connection lost');
  });

  it('exposes difficulty and category reference data', async () => {
    await expect(service.listDifficulties()).resolves.toEqual([{ difficultyId: 2, name: 'Intermediate' }]);
    await expect(service.listCategories()).resolves.toEqual([
      { categoryId: 5, name: 'Containers & Orchestration', slug: 'containers-orchestration' },
    ]);
  });
});

describe('course slug and premium validation', () => {
  it.each(['C1', 'c01', 'C001', 'course-1', 'C01M01', ''])('rejects the slug %j with a 422-class schema error', (slug) => {
    expect(createCourseSchema.safeParse({ title: 'A course', difficultyId: 1, slug }).success).toBe(false);
    expect(updateCourseSchema.safeParse({ slug }).success).toBe(false);
  });

  it('accepts Cxx slugs and an omitted slug', () => {
    expect(createCourseSchema.safeParse({ title: 'A course', difficultyId: 1, slug: 'C15' }).success).toBe(true);
    expect(createCourseSchema.safeParse({ title: 'A course', difficultyId: 1 }).success).toBe(true);
  });

  it('accepts isPremium on create and on PATCH, and rejects unknown keys', () => {
    expect(createCourseSchema.safeParse({ title: 'A course', difficultyId: 1, isPremium: true }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ isPremium: true }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ isPremium: 'yes' }).success).toBe(false);
    expect(updateCourseSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(updateCourseSchema.safeParse({}).success).toBe(false);
  });
});

describe('AdminCurriculumService.updateCourse', () => {
  let deps: Mocked<AdminCurriculumServiceDeps>;
  let service: AdminCurriculumService;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    service = new AdminCurriculumService(deps);
  });

  it('persists isPremium', async () => {
    await service.updateCourse(actor, 16, { isPremium: true });
    expect(deps.repo.updateCourse).toHaveBeenCalledWith(16, { isPremium: true }, expect.anything());
  });

  it('409s COURSE_EMPTY when publishing a course without a published module', async () => {
    deps.repo.listModules.mockResolvedValue([] as never);
    await expect(service.updateCourse(actor, 16, { isPublished: true })).rejects.toMatchObject({
      statusCode: 409,
      errors: [{ code: 'COURSE_EMPTY' }],
    });
    expect(deps.repo.updateCourse).not.toHaveBeenCalled();
  });

  it('publishes when at least one module is published', async () => {
    await service.updateCourse(actor, 16, { isPublished: true });
    expect(deps.repo.updateCourse).toHaveBeenCalledWith(16, { isPublished: true }, expect.anything());
  });

  it('409s SLUG_TAKEN when another course holds the new slug, and allows keeping its own', async () => {
    deps.repo.findCourseBySlug.mockResolvedValue(courseRow({ courseId: 99, slug: 'C07' }) as never);
    await expect(service.updateCourse(actor, 16, { slug: 'C07' })).rejects.toBeInstanceOf(ConflictError);

    deps.repo.findCourseBySlug.mockResolvedValue(courseRow() as never);
    await service.updateCourse(actor, 16, { slug: 'C03', title: 'Renamed' });
    expect(deps.repo.updateCourse).toHaveBeenCalled();
  });

  it('404s for an unknown course', async () => {
    deps.repo.findCourseById.mockResolvedValue(null as never);
    await expect(service.updateCourse(actor, 404, { title: 'Nope nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
