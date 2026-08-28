import type { LabCompletionEvent } from '../../labs/dto/labs.dto';
import type { ProgressService } from '../../progress/services/ProgressService';
import { progressService } from '../../progress/services/ProgressService';
import { logger } from '../../../shared/logger';
import type {
  CertificateDto,
  GamificationEventResult,
  GamificationProfileDto,
  GamificationSummary,
} from '../dto/gamification.dto';
import type { GamificationEventHandler } from '../handlers/gamification-event.handler';
import { gamificationEventHandler } from '../handlers/gamification-event.handler';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { LeaderboardService } from './leaderboard.service';
import { leaderboardService } from './leaderboard.service';

export interface GamificationServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'getBalance'
    | 'findLeaderboardForUser'
    | 'listUserBadges'
    | 'listUserAchievements'
    | 'listUserCertificates'
    | 'listUserActivityDates'
  >;
  progress: Pick<ProgressService, 'getLearnerProgressSnapshot' | 'computeStreak'>;
  handler: Pick<GamificationEventHandler, 'handleProgressSnapshot'>;
  leaderboard: Pick<LeaderboardService, 'getGamificationSummary'>;
}

function defaultDeps(): GamificationServiceDeps {
  return {
    repo: gamificationRepository,
    progress: progressService,
    handler: gamificationEventHandler,
    leaderboard: leaderboardService,
  };
}

function toCertificate(cert: {
  certificateId: number;
  certificateNumber: string;
  courseTitle: string;
  grade: string | null;
  issuedAt: Date;
  isValid: boolean;
}): CertificateDto {
  return {
    certificateId: cert.certificateId,
    certificateNumber: cert.certificateNumber,
    courseTitle: cert.courseTitle,
    grade: cert.grade === null ? null : Number(cert.grade),
    issuedAt: cert.issuedAt.toISOString(),
    isValid: cert.isValid,
  };
}

/**
 * F7 aggregate service. Owns the learner gamification profile (GAM-01) and
 * exposes the §02 forward-integration hooks consumed by F5/F6: badge /
 * achievement evaluation, points crediting and certificate issuance are
 * delegated to the event handler; F8 reacts to the returned events later.
 */
export class GamificationService {
  constructor(private readonly deps: GamificationServiceDeps = defaultDeps()) {}

  /** GAM-01: full learner gamification profile. */
  async getMyProfile(userId: number): Promise<GamificationProfileDto> {
    const [balance, leaderboard, badges, achievements, certificates, activityDays] = await Promise.all([
      this.deps.repo.getBalance(userId),
      this.deps.repo.findLeaderboardForUser(userId),
      this.deps.repo.listUserBadges(userId),
      this.deps.repo.listUserAchievements(userId),
      this.deps.repo.listUserCertificates(userId),
      this.deps.repo.listUserActivityDates(userId),
    ]);
    return {
      points: { balance: balance.balance, totalEarned: balance.totalEarned },
      globalRank: leaderboard?.globalRank ?? null,
      countryRank: leaderboard?.countryRank ?? null,
      badges: badges.map((badge) => ({
        badgeId: badge.badgeId,
        badgeName: badge.badgeName,
        badgeType: badge.badgeType as GamificationProfileDto['badges'][number]['badgeType'],
        iconUrl: badge.iconUrl,
        awardedAt: badge.awardedAt.toISOString(),
      })),
      achievements: achievements.map((item) => ({
        achievementId: item.achievementId,
        name: item.name,
        pointsAwarded: item.pointsAwarded,
        unlockedAt: item.unlockedAt.toISOString(),
      })),
      certificates: certificates.map(toCertificate),
      currentStreakDays: this.deps.progress.computeStreak(activityDays),
    };
  }

  /** §02 forward hook: called by F5 after any progress milestone event. */
  async processProgressSnapshot(userId: number): Promise<GamificationEventResult> {
    const snapshot = await this.deps.progress.getLearnerProgressSnapshot(userId);
    return this.deps.handler.handleProgressSnapshot(snapshot);
  }

  /** §02 forward hook: called by F6 after a LAB_COMPLETED event fires. */
  async processLabCompletion(userId: number, event: LabCompletionEvent): Promise<GamificationEventResult> {
    logger.debug({ userId, labId: event.labId, passedAt: event.passedAt }, 'F7: lab completion event consumed');
    const snapshot = await this.deps.progress.getLearnerProgressSnapshot(userId);
    return this.deps.handler.handleProgressSnapshot(snapshot);
  }

  /** §02 forward hook: summary for F2 profile dashboard / F8 analytics. */
  async getGamificationSummary(userId: number): Promise<GamificationSummary> {
    return this.deps.leaderboard.getGamificationSummary(userId);
  }
}

export const gamificationService = new GamificationService();
