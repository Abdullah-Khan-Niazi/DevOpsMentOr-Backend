import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../src/shared/errors';
import { AdminCurriculumService } from '../../../src/features/curriculum/services/AdminCurriculumService';
import type { AdminCurriculumServiceDeps } from '../../../src/features/curriculum/services/AdminCurriculumService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const actor = { userId: 1, ipAddress: '127.0.0.1', userAgent: 'vitest' };

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 16,
    title: 'Advanced Kubernetes Operations',
    slug: 'advanced-kubernetes-operations',
    description: null,
    difficultyId: 2,
    difficultyName: 'Intermediate',
    categoryId: null,
    categoryName: null,
    instructorId: 1,
    instructorName: 'Admin',
    coverImageUrl: null,
    videoTrailerUrl: null,
    estimatedHours: 12,
    totalLessons: 0,
    totalQuizzes: 0,
    isPublished: false,
    prerequisites: null,
    learningObjectives: null,
    createdAt: new Date('2026-11-05T00:00:00.000Z'),
    updatedAt: new Date('2026-11-05T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDeps(): Mocked<AdminCurriculumServiceDeps> {
  return {
    repo: {
      createCourse: vi.fn(async () => 16),
      findCourseById: vi.fn(async () => courseRow()),
      listDifficultyLevels: vi.fn(async () => [
        { difficultyId: 2, name: 'Intermediate' },
      ]),
      listCategories: vi.fn(async () => [
        { categoryId: 5, name: 'Containers & Orchestration', slug: 'containers-orchestration' },
      ]),
    },
    quiz: {},
    audit: { record: vi.fn(async () => undefined) },
  } as unknown as Mocked<AdminCurriculumServiceDeps>;
}

describe('AdminCurriculumService.createCourse (multi-course)', () => {
  let deps: Mocked<AdminCurriculumServiceDeps>;
  let service: AdminCurriculumService;

  beforeEach(() => {
    deps = makeDeps();
    service = new AdminCurriculumService(deps);
  });

  it('creates a DRAFT course with a derived slug and audits the action', async () => {
    const course = await service.createCourse(actor, {
      title: 'Advanced Kubernetes Operations',
      difficultyId: 2,
      estimatedHours: 12,
    });

    expect(deps.repo.createCourse).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'advanced-kubernetes-operations',
        isPublished: false,
        instructorId: 1,
      }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create_course', targetId: 16 }),
    );
    expect(course.isPublished).toBe(false);
  });

  it('maps a duplicate slug to a conflict with a clear message', async () => {
    deps.repo.createCourse.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }),
    );
    await expect(
      service.createCourse(actor, { title: 'Advanced Kubernetes Operations', difficultyId: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('exposes difficulty and category reference data', async () => {
    await expect(service.listDifficulties()).resolves.toEqual([
      { difficultyId: 2, name: 'Intermediate' },
    ]);
    await expect(service.listCategories()).resolves.toEqual([
      { categoryId: 5, name: 'Containers & Orchestration', slug: 'containers-orchestration' },
    ]);
  });
});
