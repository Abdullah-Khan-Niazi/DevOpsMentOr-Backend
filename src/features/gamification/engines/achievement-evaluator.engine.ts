import { logger } from '../../../shared/logger';
import type { LearnerProgressSnapshot } from '../dto/gamification.dto';
import type { AchievementRow } from '../repositories/gamification.repository';

/** Evaluation context beyond the progress snapshot (e.g. current points balance). */
export interface AchievementEvaluationContext {
  pointsBalance: number;
}

export interface AchievementEvaluationResult {
  unlocked: boolean;
  progressData: Record<string, unknown>;
}

/**
 * Reads an integer from `trigger_value` JSON. Numbers and numeric strings are
 * accepted; anything else (missing key, NaN, fractions) yields null.
 */
function readInteger(triggerValue: Record<string, unknown> | null, key: string): number | null {
  const raw = triggerValue?.[key];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isSafeInteger(value) ? value : null;
}

/** `count`-style thresholds must be positive integers; anything else is an invalid trigger. */
function readCount(
  achievement: Pick<AchievementRow, 'triggerType' | 'triggerValue'>,
  key = 'count',
): number | null {
  const value = readInteger(achievement.triggerValue, key);
  if (value === null || value < 1) {
    logger.debug(
      { triggerType: achievement.triggerType, triggerValue: achievement.triggerValue },
      'Achievement trigger_value is invalid; trigger not met',
    );
    return null;
  }
  return value;
}

/** `{ <key>: id }` triggers match when the positive id is in the learner's completed set. */
function readMemberId(
  achievement: Pick<AchievementRow, 'triggerType' | 'triggerValue'>,
  key: string,
  completedIds: readonly number[],
): boolean {
  const id = readInteger(achievement.triggerValue, key);
  if (id === null || id < 1) {
    logger.debug(
      { triggerType: achievement.triggerType, triggerValue: achievement.triggerValue },
      'Achievement trigger_value is invalid; trigger not met',
    );
    return false;
  }
  return completedIds.includes(id);
}

/**
 * F7 achievement trigger engine. Evaluates an `achievements` row's
 * `trigger_type` / `trigger_value` JSON against a `LearnerProgressSnapshot`
 * plus the user's current points balance. The evaluation is pure: awarding is
 * orchestrated by the event handler, which enforces idempotency under the
 * user lock. Invalid `trigger_value` shapes are never met.
 */
export class AchievementEvaluator {
  evaluate(
    snapshot: LearnerProgressSnapshot,
    achievement: Pick<AchievementRow, 'triggerType' | 'triggerValue'>,
    context: AchievementEvaluationContext,
  ): AchievementEvaluationResult {
    let unlocked = false;

    switch (achievement.triggerType) {
      case 'lab_completions': {
        const count = readCount(achievement);
        unlocked = count !== null && snapshot.completedLabCount >= count;
        break;
      }
      case 'course_completions': {
        const count = readCount(achievement);
        unlocked = count !== null && snapshot.completedCourseCount >= count;
        break;
      }
      case 'streak_days': {
        const count = readCount(achievement);
        unlocked = count !== null && snapshot.currentStreakDays >= count;
        break;
      }
      case 'quiz_passes':
      case 'quiz_pass_count': {
        const count = readCount(achievement);
        unlocked = count !== null && snapshot.quizPassCount >= count;
        break;
      }
      case 'lab_complete_count': {
        const count = readCount(achievement);
        unlocked = count !== null && snapshot.completedLabCount >= count;
        break;
      }
      case 'module_complete':
        unlocked = readMemberId(achievement, 'moduleId', snapshot.completedModuleIds);
        break;
      case 'course_complete':
        unlocked = readMemberId(achievement, 'courseId', snapshot.completedCourseIds);
        break;
      case 'points_balance': {
        const balance = readInteger(achievement.triggerValue, 'balance');
        unlocked = balance !== null && context.pointsBalance >= balance;
        break;
      }
      default:
        unlocked = false;
    }

    return {
      unlocked,
      progressData: {
        courseProgressPct: snapshot.courseProgressPct,
        completedCourseCount: snapshot.completedCourseCount,
        completedLessonCount: snapshot.completedLessonCount,
        completedModuleCount: snapshot.completedModuleCount,
        completedLabCount: snapshot.completedLabCount,
        quizPassCount: snapshot.quizPassCount,
        currentStreakDays: snapshot.currentStreakDays,
        pointsBalance: context.pointsBalance,
      },
    };
  }
}

export const achievementEvaluator = new AchievementEvaluator();
