import type { LearnerProgressSnapshot } from '../../progress/dto/progress.dto';
import type { AchievementUnlockedEvent, GamificationEventResult } from '../dto/gamification.dto';
import { achievementEvaluator } from '../engines/achievement-evaluator.engine';
import type { BadgeAwardEngine } from '../engines/badge-award.engine';
import { badgeAwardEngine } from '../engines/badge-award.engine';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { CertificateService } from '../services/certificate.service';
import { certificateService } from '../services/certificate.service';
import type { PointsService } from '../services/points.service';
import { pointsService } from '../services/points.service';

export interface GamificationEventHandlerDeps {
  repo: Pick<
    GamificationRepository,
    | 'getBalance'
    | 'listActiveAchievements'
    | 'hasUserAchievement'
    | 'insertUserAchievement'
    | 'listUnlockedAchievementIds'
    | 'getCanonicalCourseId'
  >;
  evaluator: Pick<AchievementEvaluatorShim, 'evaluate'>;
  badges: Pick<BadgeAwardEngine, 'evaluateAndAward'>;
  points: Pick<PointsService, 'credit'>;
  certificates: Pick<CertificateService, 'issueCertificate'>;
}

/** Structural type for the evaluator dependency (avoids hard coupling). */
interface AchievementEvaluatorShim {
  evaluate(
    snapshot: LearnerProgressSnapshot,
    achievement: { triggerType: string | null; triggerValue: Record<string, unknown> | null },
    context: { pointsBalance: number },
  ): { unlocked: boolean; progressData: Record<string, unknown> };
}

function defaultDeps(): GamificationEventHandlerDeps {
  return {
    repo: gamificationRepository,
    evaluator: achievementEvaluator,
    badges: badgeAwardEngine,
    points: pointsService,
    certificates: certificateService,
  };
}

/**
 * F7 §08 async event handler. Consumed by F5/F6 hooks via
 * `GamificationService.processProgressSnapshot` / `processLabCompletion`.
 * Orchestrates achievement evaluation, idempotent badge awarding, points
 * crediting and course-completion certificate issuance. Returns the
 * F8-consumable event lists without importing F8 (forward-integration hook).
 */
export class GamificationEventHandler {
  constructor(private readonly deps: GamificationEventHandlerDeps = defaultDeps()) {}

  async handleProgressSnapshot(snapshot: LearnerProgressSnapshot): Promise<GamificationEventResult> {
    const userId = snapshot.userId;
    const { balance } = await this.deps.repo.getBalance(userId);

    const achievements = await this.deps.repo.listActiveAchievements();
    const achievementsUnlocked: AchievementUnlockedEvent[] = [];

    for (const achievement of achievements) {
      const { unlocked, progressData } = this.deps.evaluator.evaluate(
        snapshot,
        { triggerType: achievement.triggerType, triggerValue: achievement.triggerValue },
        { pointsBalance: balance },
      );
      if (!unlocked) {
        continue;
      }
      if (await this.deps.repo.hasUserAchievement(userId, achievement.achievementId)) {
        continue;
      }
      await this.deps.repo.insertUserAchievement(userId, achievement.achievementId, progressData);
      if (achievement.pointsAwarded > 0) {
        await this.deps.points.credit(
          userId,
          achievement.pointsAwarded,
          'achievement',
          achievement.achievementId,
          `Achievement unlocked: ${achievement.name}`,
        );
      }
      achievementsUnlocked.push({
        userId,
        achievementId: achievement.achievementId,
        achievementName: achievement.name,
        pointsAwarded: achievement.pointsAwarded,
        unlockedAt: new Date(),
      });
    }

    // Re-read the balance so badge `points_threshold` triggers see points
    // credited by achievement unlocks in this same pass.
    const refreshed = await this.deps.repo.getBalance(userId);
    const unlockedIds = new Set<number>(await this.deps.repo.listUnlockedAchievementIds(userId));
    const badgesAwarded = await this.deps.badges.evaluateAndAward(userId, snapshot, {
      pointsBalance: refreshed.balance,
      unlockedAchievementIds: unlockedIds,
    });

    let certificateIssued = false;
    if (snapshot.courseProgressPct >= 100) {
      const courseId = await this.deps.repo.getCanonicalCourseId();
      if (courseId !== null) {
        await this.deps.certificates.issueCertificate(userId, courseId);
        certificateIssued = true;
      }
    }

    return { badgesAwarded, achievementsUnlocked, certificateIssued };
  }
}

export const gamificationEventHandler = new GamificationEventHandler();
