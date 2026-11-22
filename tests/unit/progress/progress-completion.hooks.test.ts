import { beforeEach, describe, expect, it, vi } from 'vitest';
import { progressCompletionHooks } from '../../../src/features/progress/services/progress-completion.hooks';
import { progressRepository } from '../../../src/features/progress/repositories/progress.repository';
import { progressService, invalidateCourseProgressCache } from '../../../src/features/progress/services/ProgressService';
import { activityLogService } from '../../../src/features/progress/services/ActivityLogService';
import { courseAccessService } from '../../../src/features/orgs/services/course-access.service';

vi.mock('../../../src/features/progress/repositories/progress.repository', () => ({
  progressRepository: {
    listPublishedItemsByLab: vi.fn(),
    listPublishedItemsByQuiz: vi.fn(),
    touchLessonProgress: vi.fn(),
    listCourseIdsOfLessons: vi.fn(),
  },
}));
vi.mock('../../../src/features/progress/services/ProgressService', () => ({
  progressService: { completeLessonWithRollups: vi.fn() },
  invalidateCourseProgressCache: vi.fn(async () => undefined),
}));
vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: { recordEvent: vi.fn(async () => undefined) },
}));
vi.mock('../../../src/features/orgs/services/course-access.service', () => ({
  courseAccessService: { getCourseAccess: vi.fn() },
}));

const TX = { tag: 'tx' } as never;
const item = (itemId: number, courseId = 1) => ({ itemId, moduleId: 10, courseId });

describe('progressCompletionHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(courseAccessService.getCourseAccess).mockResolvedValue({ canAccess: true } as never);
    vi.mocked(progressRepository.touchLessonProgress).mockResolvedValue({ row: {}, created: true } as never);
    vi.mocked(progressService.completeLessonWithRollups).mockResolvedValue({ newlyCompletedLesson: true } as never);
  });

  it('completeLabItems auto-starts a missing row, completes it and returns the newly completed ids', async () => {
    vi.mocked(progressRepository.listPublishedItemsByLab).mockResolvedValue([item(20), item(21)] as never);
    const completed = await progressCompletionHooks.completeLabItems(TX, 9, 5);
    expect(progressRepository.listPublishedItemsByLab).toHaveBeenCalledWith(5, TX);
    expect(progressRepository.touchLessonProgress).toHaveBeenCalledTimes(2);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'LESSON_STARTED', { lessonId: 20, moduleId: 10, courseId: 1 }, TX);
    expect(progressService.completeLessonWithRollups).toHaveBeenCalledWith(TX, { userId: 9, lessonId: 20, timeSpentSeconds: 0 });
    expect(completed).toEqual([20, 21]);
  });

  it('does not write LESSON_STARTED again for an already started item', async () => {
    vi.mocked(progressRepository.listPublishedItemsByQuiz).mockResolvedValue([item(30)] as never);
    vi.mocked(progressRepository.touchLessonProgress).mockResolvedValue({ row: {}, created: false } as never);
    await progressCompletionHooks.completeQuizItems(TX, 9, 4);
    expect(activityLogService.recordEvent).not.toHaveBeenCalled();
    expect(progressService.completeLessonWithRollups).toHaveBeenCalledTimes(1);
  });

  it('skips items of courses the learner cannot access (no row written)', async () => {
    vi.mocked(progressRepository.listPublishedItemsByLab).mockResolvedValue([item(20, 1), item(21, 2)] as never);
    vi.mocked(courseAccessService.getCourseAccess).mockImplementation((async (_a: unknown, courseId: number) => ({ canAccess: courseId === 1 })) as never);
    const completed = await progressCompletionHooks.completeLabItems(TX, 9, 5);
    expect(completed).toEqual([20]);
    expect(progressRepository.touchLessonProgress).toHaveBeenCalledTimes(1);
  });

  it('checks course access once per course', async () => {
    vi.mocked(progressRepository.listPublishedItemsByLab).mockResolvedValue([item(20), item(21), item(22)] as never);
    await progressCompletionHooks.completeLabItems(TX, 9, 5);
    expect(courseAccessService.getCourseAccess).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when no published item points at the lab (unpublished items are not listed)', async () => {
    vi.mocked(progressRepository.listPublishedItemsByLab).mockResolvedValue([] as never);
    await expect(progressCompletionHooks.completeLabItems(TX, 9, 5)).resolves.toEqual([]);
    expect(progressService.completeLessonWithRollups).not.toHaveBeenCalled();
  });

  it('omits items that were already completed (re-completion reports nothing new)', async () => {
    vi.mocked(progressRepository.listPublishedItemsByLab).mockResolvedValue([item(20)] as never);
    vi.mocked(progressService.completeLessonWithRollups).mockResolvedValue({ newlyCompletedLesson: false } as never);
    await expect(progressCompletionHooks.completeLabItems(TX, 9, 5)).resolves.toEqual([]);
  });

  it('afterCommit invalidates the course caches and never throws', async () => {
    vi.mocked(progressRepository.listCourseIdsOfLessons).mockResolvedValue([1, 2] as never);
    await progressCompletionHooks.afterCommit(9, [20, 21]);
    expect(invalidateCourseProgressCache).toHaveBeenCalledWith(9, [1, 2]);

    vi.mocked(progressRepository.listCourseIdsOfLessons).mockRejectedValue(new Error('db down'));
    await expect(progressCompletionHooks.afterCommit(9, [20])).resolves.toBeUndefined();
    vi.clearAllMocks();
    await progressCompletionHooks.afterCommit(9, []);
    expect(progressRepository.listCourseIdsOfLessons).not.toHaveBeenCalled();
  });
});
