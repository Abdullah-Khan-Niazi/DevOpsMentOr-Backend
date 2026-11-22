import { awardKeys } from '../config/award-keys';
import { logger } from '../../../shared/logger';
import type { BadgeAwardedEvent, BadgeType, LearnerProgressSnapshot } from '../dto/gamification.dto';
import type { BadgeRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { AwardService } from '../services/award.service';
import { awardService } from '../services/award.service';

/** Context required by the badge evaluator beyond the progress snapshot. */
export interface BadgeAwardContext {
  /** Running points balance (for `points_threshold` triggers). */
  pointsBalance: number;
  /** Achievement ids the learner has already unlocked (for `achievement_unlock`). */
  unlockedAchievementIds: Set<number>;
}

export interface BadgeEvaluationResult {
  matched: boolean;
  reason: string | null;
}

/**
 * Positive integer read from `criteria.triggerValue`. A missing or malformed
 * value yields null so the trigger is never met (a default of 0 would award the
 * badge to every learner).
 */
function threshold(triggerValue: Record<string, unknown> | null, key = 'count'): number | null {
  const raw = triggerValue?.[key];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    logger.debug({ key, triggerValue }, 'Badge trigger_value is invalid; trigger not met');
    return null;
  }
  return value;
}

export interface BadgeAwardEngineDeps {
  repo: Pick<
    GamificationRepository,
    'listBadgesWithCriteria' | 'hasUserBadge' | 'insertUserBadge'
  >;
  award: Pick<AwardService, 'withUserLock' | 'apply'>;
}

function defaultDeps(): BadgeAwardEngineDeps {
  return {
    repo: gamificationRepository,
    award: awardService,
  };
}

/** Duplicate primary key: another request already awarded this row (ER_DUP_ENTRY). */
function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/**
 * F7 badge award engine. `evaluate` is a pure eligibility check against a
 * `LearnerProgressSnapshot`; `evaluateAndAward` persists idempotently
 * (invariant 1: exactly one `user_badges` row per (user_id, badge_id)) and
 * credits the badge's `points_required` reward through the points ledger.
 */
export class BadgeAwardEngine {
  constructor(private readonly deps: BadgeAwardEngineDeps = defaultDeps()) {}

  evaluate(
    snapshot: LearnerProgressSnapshot,
    badge: BadgeRow,
    context: BadgeAwardContext,
  ): BadgeEvaluationResult {
    const trigger = badge.criteria;
    if (!trigger) {
      return { matched: false, reason: null };
    }

    switch (trigger.triggerType) {
      case 'course_complete': {
        const rawCourseId = trigger.triggerValue?.courseId;
        if (rawCourseId === undefined || rawCourseId === null) {
          return snapshot.completedCourseIds.length > 0
            ? { matched: true, reason: 'Completed a course.' }
            : { matched: false, reason: null };
        }
        const courseId = Number(rawCourseId);
        return Number.isSafeInteger(courseId) && snapshot.completedCourseIds.includes(courseId)
          ? { matched: true, reason: `Completed course #${courseId}.` }
          : { matched: false, reason: null };
      }
      case 'lab_complete': {
        const count = threshold(trigger.triggerValue);
        return count !== null && snapshot.completedLabCount >= count
          ? { matched: true, reason: `Completed ${count}+ labs.` }
          : { matched: false, reason: null };
      }
      case 'achievement_unlock': {
        const achievementId = threshold(trigger.triggerValue, 'achievementId');
        return achievementId !== null && context.unlockedAchievementIds.has(achievementId)
          ? { matched: true, reason: `Unlocked achievement #${achievementId}.` }
          : { matched: false, reason: null };
      }
      case 'points_threshold': {
        const points = threshold(trigger.triggerValue, 'points');
        return points !== null && context.pointsBalance >= points
          ? { matched: true, reason: `Reached ${points} total points.` }
          : { matched: false, reason: null };
      }
      case 'manual':
        // Manual badges are awarded via an admin flow, never auto-awarded.
        return { matched: false, reason: null };
      default:
        return { matched: false, reason: null };
    }
  }

  /** Evaluate every badge with a criteria rule and persist matching awards. */
  async evaluateAndAward(
    userId: number,
    snapshot: LearnerProgressSnapshot,
    context: BadgeAwardContext,
  ): Promise<BadgeAwardedEvent[]> {
    const badges = await this.deps.repo.listBadgesWithCriteria();
    const events: BadgeAwardedEvent[] = [];

    for (const badge of badges) {
      const { matched, reason } = this.evaluate(snapshot, badge, context);
      // Cheap pre-check outside the lock: a held badge keeps matching on every
      // learning event, and re-locking for it each time is wasted work. The
      // locked unit re-checks, so this read never decides the award alone.
      if (!matched || (await this.deps.repo.hasUserBadge(userId, badge.badgeId))) {
        continue;
      }
      const awarded = await this.awardBadge(userId, badge, reason);
      if (awarded) {
        events.push(awarded);
      }
    }
    return events;
  }

  /**
   * One award unit under the user lock: re-check `user_badges`, insert the
   * badge, then write the reward through the ledger. A duplicate key rolls
   * the unit back and skips it; other failures are logged and skipped so one
   * broken badge does not block the rest.
   */
  private async awardBadge(
    userId: number,
    badge: BadgeRow,
    reason: string | null,
  ): Promise<BadgeAwardedEvent | null> {
    const { repo, award } = this.deps;
    try {
      const awarded = await award.withUserLock(userId, async (tx) => {
        if (await repo.hasUserBadge(userId, badge.badgeId, tx)) {
          return false;
        }
        await repo.insertUserBadge(userId, badge.badgeId, reason, tx);
        await award.apply(tx, {
          userId,
          key: awardKeys.badge(badge.badgeId),
          points: badge.pointsRequired,
          sourceType: 'achievement',
          sourceId: badge.badgeId,
          label: `Badge awarded: ${badge.badgeName}`,
        });
        return true;
      });
      if (!awarded) {
        return null;
      }
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        logger.error({ err: error, userId, badgeId: badge.badgeId }, 'Badge award failed');
      }
      return null;
    }
    return {
      userId,
      badgeId: badge.badgeId,
      badgeName: badge.badgeName,
      badgeType: badge.badgeType as BadgeType,
      awardedAt: new Date(),
    };
  }
}

export const badgeAwardEngine = new BadgeAwardEngine();
