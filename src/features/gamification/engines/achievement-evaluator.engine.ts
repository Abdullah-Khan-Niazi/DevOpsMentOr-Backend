import type { LearnerProgressSnapshot } from '../../progress/dto/progress.dto';
import type { AchievementRow } from '../repositories/gamification.repository';

/** Evaluation context beyond the progress snapshot (e.g. current points balance). */
export interface AchievementEvaluationContext {
  pointsBalance: number;
}

export interface AchievementEvaluationResult {
  unlocked: boolean;
  progressData: Record<string, unknown>;
}

function threshold(triggerValue: Record<string, unknown> | null, key = 'count'): number {
  const raw = triggerValue?.[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function completedCourseCount(snapshot: LearnerProgressSnapshot): number {
  return snapshot.courseProgressPct >= 100 ? 1 : 0;
}

/**
 * F7 achievement trigger engine. Evaluates an `achievements` row's
 * `trigger_type` / `trigger_value` JSON against a `LearnerProgressSnapshot`
 * (F5) plus the user's current points balance. The evaluation is pure —
 * awarding is orchestrated by the event handler, which enforces idempotency.
 */
export class AchievementEvaluator {
  evaluate(
    snapshot: LearnerProgressSnapshot,
    achievement: Pick<AchievementRow, 'triggerType' | 'triggerValue'>,
    context: AchievementEvaluationContext,
  ): AchievementEvaluationResult {
    let unlocked = false;

    switch (achievement.triggerType) {
      case 'lab_completions':
        unlocked = snapshot.completedLabCount >= threshold(achievement.triggerValue);
        break;
      case 'course_completions':
        unlocked = completedCourseCount(snapshot) >= threshold(achievement.triggerValue);
        break;
      case 'streak_days':
        unlocked = snapshot.currentStreakDays >= threshold(achievement.triggerValue);
        break;
      case 'points_balance':
        unlocked = context.pointsBalance >= threshold(achievement.triggerValue, 'balance');
        break;
      default:
        unlocked = false;
    }

    return {
      unlocked,
      progressData: {
        courseProgressPct: snapshot.courseProgressPct,
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
