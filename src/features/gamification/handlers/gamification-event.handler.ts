import { awardKeys } from '../config/award-keys';
import { logger } from '../../../shared/logger';
import type {
  AchievementUnlockedEvent,
  GamificationEventResult,
  LearnerProgressSnapshot,
} from '../dto/gamification.dto';
import type { AchievementEvaluator } from '../engines/achievement-evaluator.engine';
import { achievementEvaluator } from '../engines/achievement-evaluator.engine';
import type { BadgeAwardEngine } from '../engines/badge-award.engine';
import { badgeAwardEngine } from '../engines/badge-award.engine';
import type { AchievementRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { AwardService } from '../services/award.service';
import { awardService } from '../services/award.service';

export interface GamificationEventHandlerDeps {
  repo: Pick<
    GamificationRepository,
    | 'getBalance'
    | 'listActiveAchievements'
    | 'hasUserAchievement'
    | 'insertUserAchievement'
    | 'listUnlockedAchievementIds'
  >;
  evaluator: Pick<AchievementEvaluator, 'evaluate'>;
  badges: Pick<BadgeAwardEngine, 'evaluateAndAward'>;
  award: Pick<AwardService, 'withUserLock' | 'apply'>;
}

function defaultDeps(): GamificationEventHandlerDeps {
  return {
    repo: gamificationRepository,
    evaluator: achievementEvaluator,
    badges: badgeAwardEngine,
    award: awardService,
  };
}

/** Duplicate primary key: another request already unlocked this achievement (ER_DUP_ENTRY). */
function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/**
 * F7 §08 event handler. Runs post-commit through `GamificationService.afterLearningEvent`
 * (never inside a lock). Evaluates achievements and badges against the learner
 * snapshot and persists every unlock as one locked unit: user_achievements
 * insert and its ledger reward commit together or not at all. Certificates are
 * issued by the service, not here.
 */
export class GamificationEventHandler {
  constructor(private readonly deps: GamificationEventHandlerDeps = defaultDeps()) {}

  async handleProgressSnapshot(snapshot: LearnerProgressSnapshot): Promise<GamificationEventResult> {
    const userId = snapshot.userId;
    const { balance } = await this.deps.repo.getBalance(userId);

    const achievements = await this.deps.repo.listActiveAchievements();
    const unlockedIds = new Set<number>(await this.deps.repo.listUnlockedAchievementIds(userId));
    const achievementsUnlocked: AchievementUnlockedEvent[] = [];

    for (const achievement of achievements) {
      if (unlockedIds.has(achievement.achievementId)) {
        continue;
      }
      const { unlocked, progressData } = this.deps.evaluator.evaluate(
        snapshot,
        { triggerType: achievement.triggerType, triggerValue: achievement.triggerValue },
        { pointsBalance: balance },
      );
      if (!unlocked) {
        continue;
      }
      const event = await this.unlockAchievement(userId, achievement, progressData);
      if (event) {
        unlockedIds.add(achievement.achievementId);
        achievementsUnlocked.push(event);
      }
    }

    // Re-read the balance so badge `points_threshold` triggers see points
    // credited by achievement unlocks in this same pass.
    const refreshed = await this.deps.repo.getBalance(userId);
    const badgesAwarded = await this.deps.badges.evaluateAndAward(userId, snapshot, {
      pointsBalance: refreshed.balance,
      unlockedAchievementIds: unlockedIds,
    });

    return { badgesAwarded, achievementsUnlocked, certificateIssued: false, certificateCourseIds: [] };
  }

  /**
   * One award unit under the user lock: re-check `user_achievements`, insert
   * the unlock, then write its reward through the ledger. A duplicate key
   * rolls the unit back and skips it; other failures are logged and skipped
   * so one broken achievement does not block the rest.
   */
  private async unlockAchievement(
    userId: number,
    achievement: AchievementRow,
    progressData: Record<string, unknown>,
  ): Promise<AchievementUnlockedEvent | null> {
    const { repo, award } = this.deps;
    try {
      const unlocked = await award.withUserLock(userId, async (tx) => {
        if (await repo.hasUserAchievement(userId, achievement.achievementId, tx)) {
          return false;
        }
        await repo.insertUserAchievement(userId, achievement.achievementId, progressData, tx);
        await award.apply(tx, {
          userId,
          key: awardKeys.achievement(achievement.achievementId),
          points: achievement.pointsAwarded,
          sourceType: 'achievement',
          sourceId: achievement.achievementId,
          label: `Achievement unlocked: ${achievement.name}`,
        });
        return true;
      });
      if (!unlocked) {
        return null;
      }
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        logger.error({ err: error, userId, achievementId: achievement.achievementId }, 'Achievement unlock failed');
      }
      return null;
    }
    return {
      userId,
      achievementId: achievement.achievementId,
      achievementName: achievement.name,
      pointsAwarded: achievement.pointsAwarded,
      unlockedAt: new Date(),
    };
  }
}

export const gamificationEventHandler = new GamificationEventHandler();
