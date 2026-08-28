import type { LearnerProgressSnapshot } from '../../progress/dto/progress.dto';
import type { BadgeAwardedEvent, BadgeType } from '../dto/gamification.dto';
import type { BadgeRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { PointsService } from '../services/points.service';
import { pointsService } from '../services/points.service';

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

function threshold(triggerValue: Record<string, unknown> | null, key = 'count'): number {
  const raw = triggerValue?.[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export interface BadgeAwardEngineDeps {
  repo: Pick<
    GamificationRepository,
    'listBadgesWithCriteria' | 'hasUserBadge' | 'insertUserBadge'
  >;
  points: Pick<PointsService, 'credit'>;
}

function defaultDeps(): BadgeAwardEngineDeps {
  return {
    repo: gamificationRepository,
    points: pointsService,
  };
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
      case 'course_complete':
        return snapshot.courseProgressPct >= 100
          ? { matched: true, reason: 'Completed the full course.' }
          : { matched: false, reason: null };
      case 'lab_complete': {
        const count = threshold(trigger.triggerValue);
        return snapshot.completedLabCount >= count
          ? { matched: true, reason: `Completed ${count}+ labs.` }
          : { matched: false, reason: null };
      }
      case 'achievement_unlock': {
        const achievementId = threshold(trigger.triggerValue, 'achievementId');
        return context.unlockedAchievementIds.has(achievementId)
          ? { matched: true, reason: `Unlocked achievement #${achievementId}.` }
          : { matched: false, reason: null };
      }
      case 'points_threshold': {
        const points = threshold(trigger.triggerValue, 'points');
        return context.pointsBalance >= points
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
      if (!matched) {
        continue;
      }
      if (await this.deps.repo.hasUserBadge(userId, badge.badgeId)) {
        continue;
      }
      await this.deps.repo.insertUserBadge(userId, badge.badgeId, reason);
      if (badge.pointsRequired > 0) {
        await this.deps.points.credit(
          userId,
          badge.pointsRequired,
          'achievement',
          badge.badgeId,
          `Badge awarded: ${badge.badgeName}`,
        );
      }
      events.push({
        userId,
        badgeId: badge.badgeId,
        badgeName: badge.badgeName,
        badgeType: badge.badgeType as BadgeType,
        awardedAt: new Date(),
      });
    }
    return events;
  }
}

export const badgeAwardEngine = new BadgeAwardEngine();
