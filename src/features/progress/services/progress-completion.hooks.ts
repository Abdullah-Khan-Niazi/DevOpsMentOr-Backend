import { logger } from '../../../shared/logger';
import type { Tx } from '../../gamification/services/award.service';
import { courseAccessService } from '../../orgs/services/course-access.service';
import type { PublishedItemRow } from '../repositories/progress.repository';
import { progressRepository } from '../repositories/progress.repository';
import { activityLogService } from './ActivityLogService';
import { invalidateCourseProgressCache, progressService } from './ProgressService';

/** Completes every visible item of the given list the learner is entitled to; returns the newly completed lesson ids. */
async function completeItems(tx: Tx, userId: number, items: PublishedItemRow[]): Promise<number[]> {
  const completed: number[] = [];
  const accessByCourse = new Map<number, boolean>();
  for (const item of items) {
    let canAccess = accessByCourse.get(item.courseId);
    if (canAccess === undefined) {
      const access = await courseAccessService.getCourseAccess(
        { userId, ipAddress: null, userAgent: null, roles: [] },
        item.courseId,
      );
      canAccess = access.canAccess;
      accessByCourse.set(item.courseId, canAccess);
    }
    if (!canAccess) {
      continue;
    }
    const { created } = await progressRepository.touchLessonProgress(tx, userId, {
      courseId: item.courseId,
      moduleId: item.moduleId,
      lessonId: item.itemId,
    });
    if (created) {
      await activityLogService.recordEvent(userId, 'LESSON_STARTED', {
        lessonId: item.itemId,
        moduleId: item.moduleId,
        courseId: item.courseId,
      }, tx);
    }
    const result = await progressService.completeLessonWithRollups(tx, {
      userId,
      lessonId: item.itemId,
      timeSpentSeconds: 0,
    });
    if (result.newlyCompletedLesson) {
      completed.push(item.itemId);
    }
  }
  return completed;
}

/**
 * Completion hooks for the lab and quiz engines. They run INSIDE the caller's
 * transaction, which already holds the user lock (`awardService.withUserLock`);
 * they never take the lock themselves and never touch the network.
 */
export const progressCompletionHooks = {
  /**
   * Called after LAB_COMPLETED is written: completes every visible spine row
   * whose lab_id is `labId` (auto-starting it when missing).
   */
  async completeLabItems(tx: Tx, userId: number, labId: number): Promise<number[]> {
    const items = await progressRepository.listPublishedItemsByLab(labId, tx);
    return completeItems(tx, userId, items);
  },

  /**
   * Called after a first pass of a quiz: completes every visible spine row whose
   * quiz_id is `quizId` (auto-starting it when missing).
   */
  async completeQuizItems(tx: Tx, userId: number, quizId: number): Promise<number[]> {
    const items = await progressRepository.listPublishedItemsByQuiz(quizId, tx);
    return completeItems(tx, userId, items);
  },

  /**
   * Post-commit follow-up for the caller of the hooks above: invalidates the
   * cached course progress of every course the completed lessons belong to.
   * Call only after the transaction committed; the caller schedules
   * `gamificationService.afterLearningEvent` itself (labs and quizzes always do).
   * Never throws.
   */
  async afterCommit(userId: number, lessonIds: number[]): Promise<void> {
    if (lessonIds.length === 0) {
      return;
    }
    try {
      const courseIds = await progressRepository.listCourseIdsOfLessons(lessonIds);
      await invalidateCourseProgressCache(userId, courseIds);
    } catch (err: unknown) {
      logger.warn({ err, userId, lessonIds }, 'Course progress cache invalidation failed');
    }
  },
};
