/**
 * F7 response DTOs and shared domain types. All dates are ISO strings.
 * Mirrors the contract §05 domain model and §07 endpoint response shapes.
 */

export type BadgeType = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'special';

/** Trigger rule stored in `badges.criteria` JSON (contract §05). */
export interface BadgeCriteria {
  triggerType: 'course_complete' | 'lab_complete' | 'achievement_unlock' | 'manual' | 'points_threshold';
  triggerValue: Record<string, unknown>;
}

/** `points_history.source_type` ENUM values used by the award engine. */
export type PointsSourceType =
  | 'machine_own'
  | 'challenge_solve'
  | 'course_complete'
  | 'achievement'
  | 'daily_bonus'
  | 'admin_adjustment'
  | 'penalty';

/** Public badge catalog row (GAM-02/03). */
export interface BadgeDto {
  badgeId: number;
  badgeName: string;
  slug: string;
  description: string | null;
  badgeType: BadgeType;
  iconUrl: string | null;
  pointsRequired: number;
  isHidden: boolean;
  createdAt: string;
}

/** Badge earned by the learner (GAM-01). Hidden badges are excluded. */
export interface UserBadgeDto {
  badgeId: number;
  badgeName: string;
  badgeType: BadgeType;
  iconUrl: string | null;
  awardedAt: string;
}

/** Public achievement catalog row (GAM-04). */
export interface AchievementDto {
  achievementId: number;
  name: string;
  description: string | null;
  pointsAwarded: number;
  triggerType: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Achievement unlocked by the learner (GAM-01). */
export interface UserAchievementDto {
  achievementId: number;
  name: string;
  pointsAwarded: number;
  unlockedAt: string;
}

/** Certificate owned by the learner (GAM-01). */
export interface CertificateDto {
  certificateId: number;
  certificateNumber: string;
  courseTitle: string;
  grade: number | null;
  issuedAt: string;
  isValid: boolean;
}

/** Points ledger row (GAM-05). */
export interface PointsHistoryDto {
  historyId: number;
  pointsChange: number;
  pointsBalanceAfter: number;
  sourceType: PointsSourceType;
  sourceId: number | null;
  description: string | null;
  createdAt: string;
}

/** SCR-F7-02 leaderboard row. */
export interface LeaderboardEntryDto {
  leaderboardId: number;
  userId: number;
  fullName: string | null;
  displayName: string | null;
  totalPoints: number;
  globalRank: number | null;
  countryRank: number | null;
  countryCode: string | null;
}

/** GAM-01: full learner gamification profile payload. */
export interface GamificationProfileDto {
  points: {
    balance: number;
    totalEarned: number;
  };
  globalRank: number | null;
  countryRank: number | null;
  badges: UserBadgeDto[];
  achievements: UserAchievementDto[];
  certificates: CertificateDto[];
  currentStreakDays: number;
}

/** GAM-14: public certificate verification payload (never leaks userId/grade/url). */
export interface CertificateVerificationDto {
  certificateNumber: string;
  holderName: string;
  courseTitle: string;
  issuedAt: string;
  isValid: boolean;
}

/** §02 consumable summary consumed by F2 profile dashboard / F8 analytics. */
export interface GamificationSummary {
  userId: number;
  totalPoints: number;
  globalRank: number | null;
  countryRank: number | null;
  badgeCount: number;
  achievementCount: number;
  certificateCount: number;
}

/** §02 badge award event consumed by F8 notification dispatch. */
export interface BadgeAwardedEvent {
  userId: number;
  badgeId: number;
  badgeName: string;
  badgeType: BadgeType;
  awardedAt: Date;
}

/** §02 achievement unlock event consumed by F8 notification dispatch. */
export interface AchievementUnlockedEvent {
  userId: number;
  achievementId: number;
  achievementName: string;
  pointsAwarded: number;
  unlockedAt: Date;
}

/** F7 event-handler outcome: what was awarded/unlocked for F8 to react to. */
export interface GamificationEventResult {
  badgesAwarded: BadgeAwardedEvent[];
  achievementsUnlocked: AchievementUnlockedEvent[];
  certificateIssued: boolean;
}
