import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  max,
  sql,
} from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  achievements,
  activityLogs,
  badges,
  certificates,
  countries,
  labs,
  leaderboardHistory,
  leaderboards,
  lessons,
  modules,
  pointsHistory,
  quizAttempts,
  quizzes,
  seasonContent,
  seasonLeaderboards,
  seasons,
  teamMembers,
  teams,
  userAchievements,
  userBadges,
  userProfiles,
  userSettings,
  users,
} from '../../../app/database/schema';
import { ORG_CONSTANTS } from '../../../shared/constants';
import type { BadgeCriteria, BadgeType, PointsSourceType } from '../dto/gamification.dto';

const PROFESSOR_ROLES = ['captain', 'co_captain'] as const;

/** Query-capable handle shared by `db` and transaction clients. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Raw `badges` row. */
export interface BadgeRow {
  badgeId: number;
  badgeName: string;
  slug: string;
  description: string | null;
  badgeType: string;
  iconUrl: string | null;
  pointsRequired: number;
  criteria: { triggerType: string; triggerValue: Record<string, unknown> } | null;
  isHidden: boolean;
  createdAt: Date;
}

/** Raw `achievements` row. */
export interface AchievementRow {
  achievementId: number;
  name: string;
  description: string | null;
  pointsAwarded: number;
  triggerType: string | null;
  triggerValue: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
}

/** Raw `certificates` row joined to course title. */
export interface CertificateRow {
  certificateId: number;
  userId: number;
  courseId: number;
  certificateNumber: string;
  grade: string | null;
  certificateUrl: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  isValid: boolean;
  courseTitle: string;
}

/** Raw `leaderboards` row. */
export interface LeaderboardRow {
  leaderboardId: number;
  userId: number;
  totalPoints: number;
  globalRank: number | null;
  countryRank: number | null;
  calculatedAt: Date;
}

/** Paginated ledger row. */
export interface PointsHistoryRow {
  historyId: number;
  pointsChange: number;
  pointsBalanceAfter: number;
  sourceType: string;
  sourceId: number | null;
  description: string | null;
  createdAt: Date;
}

/** Raw `seasons` row. */
export interface SeasonRow {
  seasonId: number;
  seasonName: string;
  seasonNumber: number;
  description: string | null;
  bannerUrl: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw `season_leaderboards` row joined to display name. */
export interface SeasonLeaderboardRow {
  leaderboardId: number;
  seasonId: number;
  userId: number;
  pointsEarned: number;
  rank: number | null;
  fullName: string | null;
  displayName: string | null;
}

/**
 * F7 data access layer. Identity, class and org scopes are resolved on the
 * backend from `team_members` / `teams` / `user_settings`; the client never
 * supplies them. `points_history` is only ever read or appended to — there is
 * no UPDATE/DELETE path on that table anywhere in this module (invariant 3).
 */
export class GamificationRepository {
  /* ── Badges ──────────────────────────────────────────────────────────── */

  async findBadge(badgeId: number): Promise<BadgeRow | null> {
    const rows = await db.select().from(badges).where(eq(badges.badgeId, badgeId)).limit(1);
    return rows[0] ?? null;
  }

  async findBadgeBySlug(slug: string): Promise<BadgeRow | null> {
    const rows = await db.select().from(badges).where(eq(badges.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async findBadgeByName(badgeName: string): Promise<BadgeRow | null> {
    const rows = await db.select().from(badges).where(eq(badges.badgeName, badgeName)).limit(1);
    return rows[0] ?? null;
  }

  /** Catalog listing; `includeHidden` is true only for platform admin. */
  async listBadges(includeHidden: boolean): Promise<BadgeRow[]> {
    return db
      .select()
      .from(badges)
      .where(includeHidden ? undefined : eq(badges.isHidden, false))
      .orderBy(asc(badges.badgeId));
  }

  /** Badges carrying a criteria rule (candidate set for the award engine). */
  async listBadgesWithCriteria(): Promise<BadgeRow[]> {
    const rows = await db
      .select()
      .from(badges)
      .where(isNotNull(badges.criteria))
      .orderBy(asc(badges.badgeId));
    return rows;
  }

  async insertBadge(input: {
    badgeName: string;
    slug: string;
    description?: string | null;
    badgeType: BadgeType;
    iconUrl?: string | null;
    pointsRequired: number;
    criteria?: BadgeCriteria | null;
    isHidden: boolean;
  }): Promise<number> {
    const inserted = await db.insert(badges).values(input);
    return inserted[0].insertId;
  }

  async updateBadge(badgeId: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(badges).set(patch).where(eq(badges.badgeId, badgeId));
  }

  /* ── user_badges ─────────────────────────────────────────────────────── */

  async hasUserBadge(userId: number, badgeId: number): Promise<boolean> {
    const rows = await db
      .select({ badgeId: userBadges.badgeId })
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)))
      .limit(1);
    return rows.length > 0;
  }

  async insertUserBadge(userId: number, badgeId: number, reason: string | null): Promise<void> {
    await db.insert(userBadges).values({ userId, badgeId, awardedReason: reason });
  }

  /** Learner-visible badges only (`is_hidden = false`), invariant 8. */
  async listUserBadges(userId: number): Promise<
    Array<{ badgeId: number; badgeName: string; badgeType: string; iconUrl: string | null; awardedAt: Date }>
  > {
    return db
      .select({
        badgeId: badges.badgeId,
        badgeName: badges.badgeName,
        badgeType: badges.badgeType,
        iconUrl: badges.iconUrl,
        awardedAt: userBadges.awardedAt,
      })
      .from(userBadges)
      .innerJoin(badges, eq(badges.badgeId, userBadges.badgeId))
      .where(and(eq(userBadges.userId, userId), eq(badges.isHidden, false)))
      .orderBy(desc(userBadges.awardedAt));
  }

  async countUserBadges(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userBadges)
      .innerJoin(badges, eq(badges.badgeId, userBadges.badgeId))
      .where(and(eq(userBadges.userId, userId), eq(badges.isHidden, false)));
    return rows[0]?.value ?? 0;
  }

  /* ── Achievements ────────────────────────────────────────────────────── */

  async findAchievement(achievementId: number): Promise<AchievementRow | null> {
    const rows = await db
      .select()
      .from(achievements)
      .where(eq(achievements.achievementId, achievementId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAchievementByName(name: string): Promise<AchievementRow | null> {
    const rows = await db
      .select()
      .from(achievements)
      .where(eq(achievements.name, name))
      .limit(1);
    return rows[0] ?? null;
  }

  async listActiveAchievements(): Promise<AchievementRow[]> {
    return db
      .select()
      .from(achievements)
      .where(eq(achievements.isActive, true))
      .orderBy(asc(achievements.achievementId));
  }

  async listAchievementsForAdmin(): Promise<AchievementRow[]> {
    return db.select().from(achievements).orderBy(asc(achievements.achievementId));
  }

  async insertAchievement(input: {
    name: string;
    description?: string | null;
    pointsAwarded: number;
    triggerType?: string | null;
    triggerValue?: Record<string, unknown> | null;
    isActive: boolean;
  }): Promise<number> {
    const inserted = await db.insert(achievements).values(input);
    return inserted[0].insertId;
  }

  async updateAchievement(achievementId: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(achievements).set(patch).where(eq(achievements.achievementId, achievementId));
  }

  /* ── user_achievements ───────────────────────────────────────────────── */

  async hasUserAchievement(userId: number, achievementId: number): Promise<boolean> {
    const rows = await db
      .select({ achievementId: userAchievements.achievementId })
      .from(userAchievements)
      .where(and(
        eq(userAchievements.userId, userId),
        eq(userAchievements.achievementId, achievementId),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async insertUserAchievement(
    userId: number,
    achievementId: number,
    progressData: Record<string, unknown> | null,
  ): Promise<void> {
    await db.insert(userAchievements).values({ userId, achievementId, progressData });
  }

  async listUserAchievements(userId: number): Promise<
    Array<{ achievementId: number; name: string; pointsAwarded: number; unlockedAt: Date }>
  > {
    return db
      .select({
        achievementId: achievements.achievementId,
        name: achievements.name,
        pointsAwarded: achievements.pointsAwarded,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .innerJoin(achievements, eq(achievements.achievementId, userAchievements.achievementId))
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.unlockedAt));
  }

  async countUserAchievements(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return rows[0]?.value ?? 0;
  }

  /* ── points_history (append-only) ────────────────────────────────────── */

  async getBalance(userId: number): Promise<{ balance: number; totalEarned: number }> {
    const [balanceRows, earnedRows] = await Promise.all([
      db
        .select({ value: max(pointsHistory.pointsBalanceAfter) })
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, userId)),
      db
        .select({ value: sql<number>`COALESCE(SUM(CASE WHEN ${pointsHistory.pointsChange} > 0 THEN ${pointsHistory.pointsChange} ELSE 0 END), 0)` })
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, userId)),
    ]);
    return { balance: balanceRows[0]?.value ?? 0, totalEarned: earnedRows[0]?.value ?? 0 };
  }

  /** Atomic ledger insert: balance computed as (prev balance + pointsChange)
   * inside the transaction. The caller may never supply `points_balance_after`. */
  async insertPoints(input: {
    userId: number;
    pointsChange: number;
    sourceType: PointsSourceType;
    sourceId?: number | null;
    description?: string | null;
  }): Promise<{ historyId: number; newBalance: number }> {
    return db.transaction(async (tx: Tx) => {
      const rows = await tx
        .select({ value: max(pointsHistory.pointsBalanceAfter) })
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, input.userId));
      const prevBalance = rows[0]?.value ?? 0;
      const newBalance = prevBalance + input.pointsChange;
      const inserted = await tx.insert(pointsHistory).values({
        userId: input.userId,
        pointsChange: input.pointsChange,
        pointsBalanceAfter: newBalance,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        description: input.description ?? null,
      });
      return { historyId: inserted[0].insertId, newBalance };
    });
  }

  async listPointsHistory(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ rows: PointsHistoryRow[]; total: number }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, userId))
        .orderBy(desc(pointsHistory.historyId))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ value: count() })
        .from(pointsHistory)
        .where(eq(pointsHistory.userId, userId)),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }

  /** Per-user total points across the whole ledger (leaderboard aggregation). */
  async sumPointsByUser(): Promise<Map<number, number>> {
    const rows = await db
      .select({ userId: pointsHistory.userId, value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)` })
      .from(pointsHistory)
      .groupBy(pointsHistory.userId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  /** Single-user total points (admin point-adjust refresh). */
  async sumPointsForUser(userId: number): Promise<number> {
    const rows = await db
      .select({ value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)` })
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId));
    return rows[0]?.value ?? 0;
  }

  /** Single-user distinct completed courses count. */
  async countCourseCompletionsForUser(userId: number): Promise<number> {
    const rows = await db
      .select({ sourceId: pointsHistory.sourceId })
      .from(pointsHistory)
      .where(and(
        eq(pointsHistory.userId, userId),
        eq(pointsHistory.sourceType, 'course_complete'),
        isNotNull(pointsHistory.sourceId),
      ));
    return new Set(rows.map((row) => row.sourceId)).size;
  }

  /** Per-user distinct completed courses (leaderboard `course_completions_count`). */
  async countCourseCompletionsByUser(): Promise<Map<number, number>> {
    const rows = await db
      .select({
        userId: pointsHistory.userId,
        value: countDistinct(pointsHistory.sourceId),
      })
      .from(pointsHistory)
      .where(and(
        eq(pointsHistory.sourceType, 'course_complete'),
        isNotNull(pointsHistory.sourceId),
      ))
      .groupBy(pointsHistory.userId);
    return new Map(rows.map((row) => [row.userId, row.value ?? 0]));
  }

  /** Sum of a user's points earned within a season date window. */
  async sumPointsBetween(userId: number, startDate: string, endDate: string): Promise<number> {
    const rows = await db
      .select({ value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)` })
      .from(pointsHistory)
      .where(and(
        eq(pointsHistory.userId, userId),
        sql`${pointsHistory.createdAt} >= ${startDate}`,
        sql`${pointsHistory.createdAt} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`,
      ));
    return rows[0]?.value ?? 0;
  }

  /** Per-user points within a season window (season leaderboard aggregation). */
  async sumPointsBetweenByUser(startDate: string, endDate: string): Promise<Map<number, number>> {
    const rows = await db
      .select({
        userId: pointsHistory.userId,
        value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)`,
      })
      .from(pointsHistory)
      .where(sql`${pointsHistory.createdAt} >= ${startDate} AND ${pointsHistory.createdAt} < DATE_ADD(${endDate}, INTERVAL 1 DAY)`)
      .groupBy(pointsHistory.userId);
    return new Map(rows.map((row) => [row.userId, row.value]));
  }

  /* ── Course completion checks (for certificate issuance) ─────────────── */

  async listUnlockedAchievementIds(userId: number): Promise<number[]> {
    const rows = await db
      .select({ achievementId: userAchievements.achievementId })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return rows.map((row) => row.achievementId);
  }

  /** The canonical course id (F4 has exactly one course per deployment). */
  async getCanonicalCourseId(): Promise<number | null> {
    const rows = await db
      .select({ courseId: academyCourses.courseId })
      .from(academyCourses)
      .where(eq(academyCourses.isPublished, true))
      .orderBy(asc(academyCourses.courseId))
      .limit(1);
    return rows[0]?.courseId ?? null;
  }

  async countTotalPublishedLessons(courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(lessons.isPublished, true)));
    return rows[0]?.value ?? 0;
  }

  async countCompletedLessons(userId: number, courseId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        eq(activityLogs.activityType, 'LESSON_COMPLETED'),
        sql`JSON_EXTRACT(${activityLogs.details}, '$.courseId') = ${courseId}`,
      ));
    return rows[0]?.value ?? 0;
  }

  /** Required (gate) quiz ids for a course, derived through its modules. */
  async listRequiredQuizIds(courseId: number): Promise<number[]> {
    const rows = await db
      .select({ quizId: quizzes.quizId })
      .from(quizzes)
      .innerJoin(modules, eq(modules.moduleId, quizzes.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(quizzes.isRequired, true)));
    return rows.map((row) => row.quizId);
  }

  /** Distinct required quizzes the user has passed at least once. */
  async countPassedRequiredQuizzes(userId: number, quizIds: number[]): Promise<number> {
    if (quizIds.length === 0) {
      return 0;
    }
    const rows = await db
      .select({ quizId: quizAttempts.quizId })
      .from(quizAttempts)
      .where(and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.isPassed, true),
        inArray(quizAttempts.quizId, quizIds),
      ));
    return new Set(rows.map((row) => row.quizId)).size;
  }

  /** Grade data at issuance: sum of passed scores + count of passed attempts
   * for the course's quizzes (invariant 13 formula). */
  async getGradeData(courseId: number): Promise<{ passedSum: number; passedCount: number }> {
    const rows = await db
      .select({
        sumScore: sql<number>`COALESCE(SUM(${quizAttempts.score}), 0)`,
        passedCount: count(),
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizzes.quizId, quizAttempts.quizId))
      .innerJoin(modules, eq(modules.moduleId, quizzes.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(quizAttempts.isPassed, true)));
    return { passedSum: rows[0]?.sumScore ?? 0, passedCount: rows[0]?.passedCount ?? 0 };
  }

  /* ── certificates ────────────────────────────────────────────────────── */

  async findCertificateById(certId: number): Promise<CertificateRow | null> {
    const rows = await db
      .select({
        certificateId: certificates.certificateId,
        userId: certificates.userId,
        courseId: certificates.courseId,
        certificateNumber: certificates.certificateNumber,
        grade: certificates.grade,
        certificateUrl: certificates.certificateUrl,
        issuedAt: certificates.issuedAt,
        expiresAt: certificates.expiresAt,
        isValid: certificates.isValid,
        courseTitle: academyCourses.title,
      })
      .from(certificates)
      .innerJoin(academyCourses, eq(academyCourses.courseId, certificates.courseId))
      .where(eq(certificates.certificateId, certId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCertificateByUserCourse(userId: number, courseId: number): Promise<CertificateRow | null> {
    const rows = await db
      .select({
        certificateId: certificates.certificateId,
        userId: certificates.userId,
        courseId: certificates.courseId,
        certificateNumber: certificates.certificateNumber,
        grade: certificates.grade,
        certificateUrl: certificates.certificateUrl,
        issuedAt: certificates.issuedAt,
        expiresAt: certificates.expiresAt,
        isValid: certificates.isValid,
        courseTitle: academyCourses.title,
      })
      .from(certificates)
      .innerJoin(academyCourses, eq(academyCourses.courseId, certificates.courseId))
      .where(and(
        eq(certificates.userId, userId),
        eq(certificates.courseId, courseId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCertificateByNumber(certificateNumber: string): Promise<CertificateRow | null> {
    const rows = await db
      .select({
        certificateId: certificates.certificateId,
        userId: certificates.userId,
        courseId: certificates.courseId,
        certificateNumber: certificates.certificateNumber,
        grade: certificates.grade,
        certificateUrl: certificates.certificateUrl,
        issuedAt: certificates.issuedAt,
        expiresAt: certificates.expiresAt,
        isValid: certificates.isValid,
        courseTitle: academyCourses.title,
      })
      .from(certificates)
      .innerJoin(academyCourses, eq(academyCourses.courseId, certificates.courseId))
      .where(eq(certificates.certificateNumber, certificateNumber))
      .limit(1);
    return rows[0] ?? null;
  }

  async listUserCertificates(userId: number): Promise<CertificateRow[]> {
    return db
      .select({
        certificateId: certificates.certificateId,
        userId: certificates.userId,
        courseId: certificates.courseId,
        certificateNumber: certificates.certificateNumber,
        grade: certificates.grade,
        certificateUrl: certificates.certificateUrl,
        issuedAt: certificates.issuedAt,
        expiresAt: certificates.expiresAt,
        isValid: certificates.isValid,
        courseTitle: academyCourses.title,
      })
      .from(certificates)
      .innerJoin(academyCourses, eq(academyCourses.courseId, certificates.courseId))
      .where(eq(certificates.userId, userId))
      .orderBy(desc(certificates.issuedAt));
  }

  async countUserCertificates(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(certificates)
      .where(eq(certificates.userId, userId));
    return rows[0]?.value ?? 0;
  }

  async insertCertificate(input: {
    userId: number;
    courseId: number;
    certificateNumber: string;
    grade: string | null;
    certificateUrl: string;
  }): Promise<number> {
    const inserted = await db.insert(certificates).values(input);
    return inserted[0].insertId;
  }

  async updateCertificateValidity(certId: number, isValid: boolean): Promise<void> {
    await db.update(certificates).set({ isValid }).where(eq(certificates.certificateId, certId));
  }

  async updateVerifierIp(certId: number, ip: string): Promise<void> {
    await db.update(certificates).set({ verifierIp: ip }).where(eq(certificates.certificateId, certId));
  }

  /* ── leaderboards ────────────────────────────────────────────────────── */

  async findLeaderboardForUser(userId: number): Promise<LeaderboardRow | null> {
    const rows = await db
      .select()
      .from(leaderboards)
      .where(eq(leaderboards.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** UPSERT the aggregated points row (per-user single row). */
  async upsertLeaderboard(userId: number, totalPoints: number, courseCompletionsCount: number): Promise<void> {
    await db
      .insert(leaderboards)
      .values({
        userId,
        totalPoints,
        machineOwnsCount: 0,
        challengeSolvesCount: 0,
        courseCompletionsCount,
        calculatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          totalPoints,
          courseCompletionsCount,
          calculatedAt: new Date(),
        },
      });
  }

  /** All leaderboard rows ordered by points desc (global rank assignment). */
  async listAllLeaderboardRows(): Promise<Array<{ leaderboardId: number; userId: number; totalPoints: number }>> {
    return db
      .select({ leaderboardId: leaderboards.leaderboardId, userId: leaderboards.userId, totalPoints: leaderboards.totalPoints })
      .from(leaderboards)
      .orderBy(desc(leaderboards.totalPoints), asc(leaderboards.userId));
  }

  /** Leaderboard rows with their user country (country rank assignment). */
  async listCountryScopedRows(): Promise<Array<{ leaderboardId: number; userId: number; countryId: number }>> {
    const rows = await db
      .select({
        leaderboardId: leaderboards.leaderboardId,
        userId: leaderboards.userId,
        countryId: userProfiles.countryId,
      })
      .from(leaderboards)
      .innerJoin(userProfiles, eq(userProfiles.userId, leaderboards.userId))
      .where(isNotNull(userProfiles.countryId));
    return rows.map((row) => ({ ...row, countryId: row.countryId as number }));
  }

  async setGlobalRank(leaderboardId: number, rank: number | null): Promise<void> {
    await db.update(leaderboards).set({ globalRank: rank }).where(eq(leaderboards.leaderboardId, leaderboardId));
  }

  async setCountryRank(leaderboardId: number, rank: number | null): Promise<void> {
    await db.update(leaderboards).set({ countryRank: rank }).where(eq(leaderboards.leaderboardId, leaderboardId));
  }

  async insertHistorySnapshot(rows: Array<{ userId: number; totalPoints: number; globalRank: number | null }>): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await db.insert(leaderboardHistory).values(rows);
  }

  /** Paginated global leaderboard joined to users and country codes. */
  async getGlobalLeaderboard(page: number, limit: number): Promise<{
    rows: Array<LeaderboardEntryLike>;
    total: number;
  }> {
    const baseWhere = undefined;
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          leaderboardId: leaderboards.leaderboardId,
          userId: leaderboards.userId,
          fullName: users.fullName,
          displayName: users.displayName,
          totalPoints: leaderboards.totalPoints,
          globalRank: leaderboards.globalRank,
          countryRank: leaderboards.countryRank,
          countryCode: countries.countryCode,
        })
        .from(leaderboards)
        .innerJoin(users, eq(users.userId, leaderboards.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, leaderboards.userId))
        .leftJoin(countries, eq(countries.countryId, userProfiles.countryId))
        .where(baseWhere)
        .orderBy(asc(leaderboards.globalRank), desc(leaderboards.totalPoints))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(leaderboards),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }

  /** Paginated country-scoped leaderboard. */
  async getCountryLeaderboard(countryId: number, page: number, limit: number): Promise<{
    rows: Array<LeaderboardEntryLike>;
    total: number;
  }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          leaderboardId: leaderboards.leaderboardId,
          userId: leaderboards.userId,
          fullName: users.fullName,
          displayName: users.displayName,
          totalPoints: leaderboards.totalPoints,
          globalRank: leaderboards.globalRank,
          countryRank: leaderboards.countryRank,
          countryCode: countries.countryCode,
        })
        .from(leaderboards)
        .innerJoin(users, eq(users.userId, leaderboards.userId))
        .innerJoin(userProfiles, eq(userProfiles.userId, leaderboards.userId))
        .innerJoin(countries, eq(countries.countryId, userProfiles.countryId))
        .where(eq(userProfiles.countryId, countryId))
        .orderBy(asc(leaderboards.countryRank), desc(leaderboards.totalPoints))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ value: count() })
        .from(leaderboards)
        .innerJoin(userProfiles, eq(userProfiles.userId, leaderboards.userId))
        .where(eq(userProfiles.countryId, countryId)),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }

  /** Cohort leaderboard: a specific set of user ids. */
  async getLeaderboardForUsers(userIds: number[]): Promise<LeaderboardEntryLike[]> {
    if (userIds.length === 0) {
      return [];
    }
    return db
      .select({
        leaderboardId: leaderboards.leaderboardId,
        userId: leaderboards.userId,
        fullName: users.fullName,
        displayName: users.displayName,
        totalPoints: leaderboards.totalPoints,
        globalRank: leaderboards.globalRank,
        countryRank: leaderboards.countryRank,
        countryCode: countries.countryCode,
      })
      .from(leaderboards)
      .innerJoin(users, eq(users.userId, leaderboards.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, leaderboards.userId))
      .leftJoin(countries, eq(countries.countryId, userProfiles.countryId))
      .where(inArray(leaderboards.userId, userIds))
      .orderBy(desc(leaderboards.totalPoints), asc(leaderboards.userId));
  }

  async getCountryIdByCode(countryCode: string): Promise<number | null> {
    const rows = await db
      .select({ countryId: countries.countryId })
      .from(countries)
      .where(eq(countries.countryCode, countryCode))
      .limit(1);
    return rows[0]?.countryId ?? null;
  }

  /* ── seasons ─────────────────────────────────────────────────────────── */

  async listSeasons(): Promise<SeasonRow[]> {
    return db.select().from(seasons).orderBy(desc(seasons.seasonNumber));
  }

  /** Whether a lab exists (season content integrity check for `lab` items). */
  async labExists(labId: number): Promise<boolean> {
    const rows = await db
      .select({ labId: labs.labId })
      .from(labs)
      .where(eq(labs.labId, labId))
      .limit(1);
    return rows.length > 0;
  }

  async findSeason(seasonId: number): Promise<SeasonRow | null> {
    const rows = await db.select().from(seasons).where(eq(seasons.seasonId, seasonId)).limit(1);
    return rows[0] ?? null;
  }

  async findActiveSeason(): Promise<SeasonRow | null> {
    const rows = await db
      .select()
      .from(seasons)
      .where(eq(seasons.isActive, true))
      .orderBy(desc(seasons.seasonNumber))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active seasons whose date window overlaps the given window. */
  async findOverlappingSeasons(
    startDate: string,
    endDate: string,
    excludeSeasonId?: number,
  ): Promise<SeasonRow[]> {
    const condition = and(
      eq(seasons.isActive, true),
      sql`${seasons.startDate} <= ${endDate}`,
      sql`${seasons.endDate} >= ${startDate}`,
      excludeSeasonId !== undefined ? sql`${seasons.seasonId} <> ${excludeSeasonId}` : undefined,
    );
    return db.select().from(seasons).where(condition);
  }

  async insertSeason(input: {
    seasonName: string;
    seasonNumber: number;
    description?: string | null;
    bannerUrl?: string | null;
    startDate: string;
    endDate: string;
    isActive: boolean;
  }): Promise<number> {
    const inserted = await db.insert(seasons).values(input);
    return inserted[0].insertId;
  }

  async updateSeason(seasonId: number, patch: Record<string, unknown>): Promise<void> {
    await db.update(seasons).set(patch).where(eq(seasons.seasonId, seasonId));
  }

  async listSeasonContent(seasonId: number): Promise<
    Array<{ contentType: string; contentId: number; releaseOrder: number; isReleased: boolean; releasedAt: Date | null }>
  > {
    return db
      .select({
        contentType: seasonContent.contentType,
        contentId: seasonContent.contentId,
        releaseOrder: seasonContent.releaseOrder,
        isReleased: seasonContent.isReleased,
        releasedAt: seasonContent.releasedAt,
      })
      .from(seasonContent)
      .where(eq(seasonContent.seasonId, seasonId))
      .orderBy(asc(seasonContent.releaseOrder));
  }

  async replaceSeasonContent(
    seasonId: number,
    items: Array<{
      contentType: 'lab' | 'machine' | 'challenge';
      contentId: number;
      releaseOrder: number;
      isReleased: boolean;
    }>,
  ): Promise<void> {
    await db.delete(seasonContent).where(eq(seasonContent.seasonId, seasonId));
    if (items.length > 0) {
      await db.insert(seasonContent).values(
        items.map((item) => ({ seasonId, ...item })),
      );
    }
  }

  /** Paginated season leaderboard joined to users. */
  async getSeasonLeaderboard(seasonId: number, page: number, limit: number): Promise<{
    rows: SeasonLeaderboardRow[];
    total: number;
  }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          leaderboardId: seasonLeaderboards.leaderboardId,
          seasonId: seasonLeaderboards.seasonId,
          userId: seasonLeaderboards.userId,
          pointsEarned: seasonLeaderboards.pointsEarned,
          rank: seasonLeaderboards.rank,
          fullName: users.fullName,
          displayName: users.displayName,
        })
        .from(seasonLeaderboards)
        .innerJoin(users, eq(users.userId, seasonLeaderboards.userId))
        .where(eq(seasonLeaderboards.seasonId, seasonId))
        .orderBy(asc(seasonLeaderboards.rank), desc(seasonLeaderboards.pointsEarned), asc(users.userId))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ value: count() })
        .from(seasonLeaderboards)
        .where(eq(seasonLeaderboards.seasonId, seasonId)),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }

  /** All season rows for the season (rank assignment + standing). */
  async listAllSeasonRows(seasonId: number): Promise<Array<{ leaderboardId: number; userId: number; pointsEarned: number }>> {
    return db
      .select({
        leaderboardId: seasonLeaderboards.leaderboardId,
        userId: seasonLeaderboards.userId,
        pointsEarned: seasonLeaderboards.pointsEarned,
      })
      .from(seasonLeaderboards)
      .where(eq(seasonLeaderboards.seasonId, seasonId))
      .orderBy(desc(seasonLeaderboards.pointsEarned), asc(seasonLeaderboards.userId));
  }

  /** UPSERT one user's season points (unique_season_user constraint). */
  async upsertSeasonLeaderboard(seasonId: number, userId: number, pointsEarned: number): Promise<void> {
    await db
      .insert(seasonLeaderboards)
      .values({ seasonId, userId, pointsEarned })
      .onDuplicateKeyUpdate({ set: { pointsEarned } });
  }

  async setSeasonRank(leaderboardId: number, rank: number | null): Promise<void> {
    await db.update(seasonLeaderboards).set({ rank }).where(eq(seasonLeaderboards.leaderboardId, leaderboardId));
  }

  async findSeasonLeaderboardRow(seasonId: number, userId: number): Promise<SeasonLeaderboardRow | null> {
    const rows = await db
      .select({
        leaderboardId: seasonLeaderboards.leaderboardId,
        seasonId: seasonLeaderboards.seasonId,
        userId: seasonLeaderboards.userId,
        pointsEarned: seasonLeaderboards.pointsEarned,
        rank: seasonLeaderboards.rank,
        fullName: users.fullName,
        displayName: users.displayName,
      })
      .from(seasonLeaderboards)
      .innerJoin(users, eq(users.userId, seasonLeaderboards.userId))
      .where(and(
        eq(seasonLeaderboards.seasonId, seasonId),
        eq(seasonLeaderboards.userId, userId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ── Cohort scoping (class / org membership, backend-derived) ────────── */

  async isProfessorOfClass(classId: number, userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.userId, userId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async findClass(classId: number): Promise<{ organizationId: number | null; className: string } | null> {
    const rows = await db
      .select({ organizationId: teams.organizationId, className: teams.teamName })
      .from(teams)
      .where(eq(teams.teamId, classId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listClassStudentIds(classId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.role, 'member'), eq(teamMembers.isActive, true)));
    return rows.map((row) => row.userId);
  }

  async getOrgId(userId: number): Promise<number | null> {
    const rows = await db
      .select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(and(
        eq(userSettings.userId, userId),
        eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
      ))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /** Active members of classes belonging to an organization. */
  async listOrgMemberIds(orgId: number): Promise<number[]> {
    const rows = await db
      .selectDistinct({ userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(eq(teams.organizationId, orgId), eq(teamMembers.isActive, true)));
    return rows.map((row) => row.userId);
  }

  /* ── Users & streaks ─────────────────────────────────────────────────── */

  async findUser(userId: number): Promise<{ userId: number; fullName: string | null } | null> {
    const rows = await db
      .select({ userId: users.userId, fullName: users.fullName })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserName(userId: number): Promise<{ fullName: string | null; displayName: string | null } | null> {
    const rows = await db
      .select({ fullName: users.fullName, displayName: users.displayName })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Activity-day strings for streak computation (read-only from F5 logs). */
  async listUserActivityDates(userId: number, sinceDays = 400): Promise<string[]> {
    const rows = await db
      .select({ day: sql<string>`DATE_FORMAT(${activityLogs.createdAt}, '%Y-%m-%d')` })
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        sql`${activityLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sinceDays} DAY)`,
      ))
      .groupBy(sql.raw('DATE_FORMAT(created_at, \'%Y-%m-%d\')'));
    return rows.map((row) => row.day);
  }
}

/** Shape shared by all leaderboard entry queries. */
export interface LeaderboardEntryLike {
  leaderboardId: number;
  userId: number;
  fullName: string | null;
  displayName: string | null;
  totalPoints: number;
  globalRank: number | null;
  countryRank: number | null;
  countryCode: string | null;
}

export const gamificationRepository = new GamificationRepository();
