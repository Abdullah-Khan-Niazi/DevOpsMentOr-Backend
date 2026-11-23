import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { PERMISSIONS, ROLES } from '../../../shared/constants';
import type { MembershipRepository } from '../../orgs/repositories/membership.repository';
import { membershipRepository } from '../../orgs/repositories/membership.repository';
import type { GamificationSummary, LeaderboardEntryDto } from '../dto/gamification.dto';
import type { GamificationRepository, LeaderboardEntryLike, SeasonLeaderboardRow } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';
import type { AwardService } from './award.service';
import { awardService } from './award.service';

/** Session-derived actor (never client-supplied identifiers). */
export interface GamificationActor {
  userId: number;
  roles: string[];
  permissions: string[];
}

export interface PaginatedLeaderboard<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  viewerRank: number | null;
  viewerPoints?: number | null;
  pointsToNextRank?: number | null;
}

export interface LeaderboardServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'getGlobalLeaderboard'
    | 'getCountryLeaderboard'
    | 'getCountryIdByCode'
    | 'getSeasonLeaderboard'
    | 'findSeason'
    | 'findSeasonLeaderboardRow'
    | 'getLeaderboardForUsers'
    | 'findClass'
    | 'isProfessorOfClass'
    | 'organizationExists'
    | 'listClassStudentIds'
    | 'listOrgMemberIds'
    | 'findLeaderboardForUser'
    | 'getBalance'
    | 'countUserBadges'
    | 'countUserAchievements'
    | 'countUserCertificates'
    | 'sumPointsForUser'
    | 'countCourseCompletionsForUser'
    | 'listLeaderboardIdsForUser'
    | 'updateLeaderboardTotals'
    | 'insertLeaderboard'
    | 'deleteOtherLeaderboardRows'
  > &
    Partial<
      Pick<
        GamificationRepository,
        | 'isStudentOfClass'
        | 'findPreviousGlobalRanks'
        | 'findNextScoreAboveGlobal'
        | 'findNextScoreAboveCountry'
        | 'findNextScoreAboveSeason'
      >
    >;
  memberships: Pick<MembershipRepository, 'getRoleInOrg'>;
  award: Pick<AwardService, 'withUserLock'>;
}

function defaultDeps(): LeaderboardServiceDeps {
  return { repo: gamificationRepository, memberships: membershipRepository, award: awardService };
}

/** Totals written by `refreshUserTotals` (ranks follow on the next job run). */
export interface LeaderboardTotals {
  totalPoints: number;
  courseCompletionsCount: number;
}

function toEntry(
  row: LeaderboardEntryLike,
  previousGlobalRanks?: Map<number, number>,
): LeaderboardEntryDto {
  const previousGlobalRank = previousGlobalRanks?.get(row.userId) ?? null;
  const rankDelta =
    row.rankDelta !== undefined
      ? row.rankDelta
      : previousGlobalRank !== null && row.globalRank !== null
        ? previousGlobalRank - row.globalRank
        : null;

  return {
    leaderboardId: row.leaderboardId,
    userId: row.userId,
    ...(row.username !== undefined ? { username: row.username } : {}),
    fullName: row.fullName,
    displayName: row.displayName,
    ...(row.avatarUrl !== undefined ? { avatarUrl: row.avatarUrl } : {}),
    totalPoints: row.totalPoints,
    ...(row.courseCompletionsCount !== undefined
      ? { courseCompletionsCount: row.courseCompletionsCount }
      : {}),
    globalRank: row.globalRank,
    countryRank: row.countryRank,
    ...(row.cohortRank !== undefined ? { cohortRank: row.cohortRank } : {}),
    ...(rankDelta !== null ? { rankDelta } : {}),
    countryCode: row.countryCode,
  };
}

function withCohortRanks(rows: LeaderboardEntryLike[], previousGlobalRanks?: Map<number, number>): LeaderboardEntryDto[] {
  const sorted = [...rows].sort((a, b) => b.totalPoints - a.totalPoints || a.userId - b.userId);
  let lastRank = 0;
  return sorted.map((row, index) => {
    const rank = index > 0 && row.totalPoints === sorted[index - 1].totalPoints ? lastRank : index + 1;
    lastRank = rank;
    return toEntry({ ...row, cohortRank: rank }, previousGlobalRanks);
  });
}

function cohortViewerStanding(entries: LeaderboardEntryDto[], viewerUserId: number): {
  viewerRank: number | null;
  viewerPoints: number | null;
  pointsToNextRank: number | null;
} {
  const viewer = entries.find((e) => e.userId === viewerUserId);
  if (!viewer) {
    return { viewerRank: null, viewerPoints: null, pointsToNextRank: null };
  }
  const higherScores = entries
    .map((e) => e.totalPoints)
    .filter((pts) => pts > viewer.totalPoints);
  const nextAbove = higherScores.length > 0 ? Math.min(...higherScores) : null;
  return {
    viewerRank: viewer.cohortRank ?? null,
    viewerPoints: viewer.totalPoints,
    pointsToNextRank: nextAbove !== null ? nextAbove - viewer.totalPoints : null,
  };
}

function toSeasonEntry(row: SeasonLeaderboardRow): {
  leaderboardId: number;
  userId: number;
  username?: string;
  pointsEarned: number;
  rank: number | null;
  fullName: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  countryCode?: string | null;
} {
  return {
    leaderboardId: row.leaderboardId,
    userId: row.userId,
    ...(row.username !== undefined ? { username: row.username } : {}),
    pointsEarned: row.pointsEarned,
    rank: row.rank,
    fullName: row.fullName,
    displayName: row.displayName,
    ...(row.avatarUrl !== undefined ? { avatarUrl: row.avatarUrl } : {}),
    ...(row.countryCode !== undefined ? { countryCode: row.countryCode } : {}),
  };
}

/** Platform scope: the platform-admin role or the gamification manage permission the routes accept. */
function isPlatformAdmin(actor: GamificationActor): boolean {
  return (
    actor.roles.includes(ROLES.PLATFORM_ADMIN) ||
    actor.permissions.includes(PERMISSIONS.PLATFORM_GAMIFICATION_MANAGE)
  );
}

/**
 * F7 leaderboard service. Global/country/season views are public reads over
 * the recomputed `leaderboards` / `season_leaderboards` snapshots; class/org
 * views are scoped cohorts resolved from the session (BOLA: membership is
 * verified server-side, never taken from the request body).
 */
export class LeaderboardService {
  constructor(private readonly deps: LeaderboardServiceDeps = defaultDeps()) {}

  /** GAM-06: paginated global leaderboard with the viewer's own rank and gap to next rank. */
  async getGlobal(
    page: number,
    limit: number,
    viewerUserId: number | null,
  ): Promise<PaginatedLeaderboard<LeaderboardEntryDto>> {
    const { rows, total } = await this.deps.repo.getGlobalLeaderboard(page, limit);
    const previousRanks =
      typeof this.deps.repo.findPreviousGlobalRanks === 'function'
        ? await this.deps.repo.findPreviousGlobalRanks(rows.map((r) => r.userId))
        : undefined;
    const viewerRow = viewerUserId !== null ? await this.deps.repo.findLeaderboardForUser(viewerUserId) : null;
    const viewerRank = viewerRow?.globalRank ?? null;
    const viewerPoints = viewerRow?.totalPoints ?? null;
    const nextScore =
      viewerRow && typeof this.deps.repo.findNextScoreAboveGlobal === 'function'
        ? await this.deps.repo.findNextScoreAboveGlobal(viewerRow.totalPoints)
        : null;
    const pointsToNextRank =
      viewerRow && nextScore !== null ? Math.max(0, nextScore - viewerRow.totalPoints) : null;
    return {
      items: rows.map((row) => toEntry(row, previousRanks)),
      total,
      page,
      limit,
      viewerRank,
      viewerPoints,
      pointsToNextRank,
    };
  }

  /** GAM-07: paginated country-scoped leaderboard with viewer's country-scoped rank. */
  async getByCountry(
    countryCode: string,
    page: number,
    limit: number,
    viewerUserId: number | null,
  ): Promise<PaginatedLeaderboard<LeaderboardEntryDto>> {
    const countryId = await this.deps.repo.getCountryIdByCode(countryCode);
    if (countryId === null) {
      throw new NotFoundError('Country not found.');
    }
    const { rows, total } = await this.deps.repo.getCountryLeaderboard(countryId, page, limit);
    const previousRanks =
      typeof this.deps.repo.findPreviousGlobalRanks === 'function'
        ? await this.deps.repo.findPreviousGlobalRanks(rows.map((r) => r.userId))
        : undefined;
    const viewerRow = viewerUserId !== null ? await this.deps.repo.findLeaderboardForUser(viewerUserId) : null;
    const viewerRank = viewerRow?.countryRank ?? null;
    const viewerPoints = viewerRow?.totalPoints ?? null;
    const nextScore =
      viewerRow && typeof this.deps.repo.findNextScoreAboveCountry === 'function'
        ? await this.deps.repo.findNextScoreAboveCountry(countryId, viewerRow.totalPoints)
        : null;
    const pointsToNextRank =
      viewerRow && nextScore !== null ? Math.max(0, nextScore - viewerRow.totalPoints) : null;
    return {
      items: rows.map((row) => toEntry(row, previousRanks)),
      total,
      page,
      limit,
      viewerRank,
      viewerPoints,
      pointsToNextRank,
    };
  }

  /** GAM-08: paginated season standings for a season. */
  async getSeason(
    seasonId: number,
    page: number,
    limit: number,
    viewerUserId: number | null,
  ): Promise<PaginatedLeaderboard<ReturnType<typeof toSeasonEntry>>> {
    const season = await this.deps.repo.findSeason(seasonId);
    if (!season) {
      throw new NotFoundError('Season not found.');
    }
    const { rows, total } = await this.deps.repo.getSeasonLeaderboard(seasonId, page, limit);
    let viewerRank: number | null = null;
    let viewerPoints: number | null = null;
    let pointsToNextRank: number | null = null;
    if (viewerUserId !== null) {
      const own = await this.deps.repo.findSeasonLeaderboardRow(seasonId, viewerUserId);
      viewerRank = own?.rank ?? null;
      viewerPoints = own?.pointsEarned ?? null;
      if (own && typeof this.deps.repo.findNextScoreAboveSeason === 'function') {
        const nextScore = await this.deps.repo.findNextScoreAboveSeason(seasonId, own.pointsEarned);
        pointsToNextRank = nextScore !== null ? Math.max(0, nextScore - own.pointsEarned) : null;
      }
    }
    return { items: rows.map(toSeasonEntry), total, page, limit, viewerRank, viewerPoints, pointsToNextRank };
  }

  /** GAM-09: class-scoped leaderboard for the professor, org admin, or enrolled students of that class. */
  async getClass(
    classId: number,
    actor: GamificationActor,
  ): Promise<{
    className: string;
    items: LeaderboardEntryDto[];
    total: number;
    viewerRank: number | null;
    viewerPoints: number | null;
    pointsToNextRank: number | null;
  }> {
    const cls = await this.deps.repo.findClass(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    if (!isPlatformAdmin(actor)) {
      // Multi-org (D15): check professor of class, org_admin of class's org, or active student enrolled in class.
      const isProfessor = await this.deps.repo.isProfessorOfClass(classId, actor.userId);
      const isClassOrgAdmin =
        !isProfessor &&
        cls.organizationId !== null &&
        (await this.deps.memberships.getRoleInOrg(actor.userId, cls.organizationId)) === ROLES.ORG_ADMIN;
      const isEnrolledStudent =
        !isProfessor &&
        !isClassOrgAdmin &&
        typeof this.deps.repo.isStudentOfClass === 'function' &&
        (await this.deps.repo.isStudentOfClass(classId, actor.userId));
      if (!isProfessor && !isClassOrgAdmin && !isEnrolledStudent) {
        throw new ForbiddenError('You do not have access to this class.');
      }
    }
    const userIds = await this.deps.repo.listClassStudentIds(classId);
    const rows = await this.deps.repo.getLeaderboardForUsers(userIds);
    const previousRanks =
      typeof this.deps.repo.findPreviousGlobalRanks === 'function'
        ? await this.deps.repo.findPreviousGlobalRanks(rows.map((r) => r.userId))
        : undefined;
    const items = withCohortRanks(rows, previousRanks);
    const standing = cohortViewerStanding(items, actor.userId);
    return { className: cls.className, items, total: items.length, ...standing };
  }

  /** GAM-10: org-scoped leaderboard for an admin of that org / platform admin. */
  async getOrg(
    orgId: number,
    actor: GamificationActor,
  ): Promise<{
    items: LeaderboardEntryDto[];
    total: number;
    viewerRank: number | null;
    viewerPoints: number | null;
    pointsToNextRank: number | null;
  }> {
    if (isPlatformAdmin(actor)) {
      if (!(await this.deps.repo.organizationExists(orgId))) {
        throw new NotFoundError('Organization not found.');
      }
    } else if ((await this.deps.memberships.getRoleInOrg(actor.userId, orgId)) !== ROLES.ORG_ADMIN) {
      throw new ForbiddenError('You do not have access to this organization.');
    }
    const userIds = await this.deps.repo.listOrgMemberIds(orgId);
    const rows = await this.deps.repo.getLeaderboardForUsers(userIds);
    const previousRanks =
      typeof this.deps.repo.findPreviousGlobalRanks === 'function'
        ? await this.deps.repo.findPreviousGlobalRanks(rows.map((r) => r.userId))
        : undefined;
    const items = withCohortRanks(rows, previousRanks);
    const standing = cohortViewerStanding(items, actor.userId);
    return { items, total: items.length, ...standing };
  }

  /**
   * Writes the user's `leaderboards` totals immediately (contracts §5.3):
   * `total_points` = SUM of every ledger delta (penalties included) and the
   * distinct completed courses. Ranks are assigned by the next job run.
   * `leaderboards` has no unique key on `user_id`, so the "upsert" is a
   * select-then-update/insert under the user lock; legacy duplicate rows of
   * the user are removed on the way. Never call it while holding a lock.
   */
  async refreshUserTotals(userId: number): Promise<LeaderboardTotals> {
    const { repo } = this.deps;
    return this.deps.award.withUserLock(userId, async (tx) => {
      // Sequential: one transaction is one connection.
      const totalPoints = await repo.sumPointsForUser(userId, tx);
      const courseCompletionsCount = await repo.countCourseCompletionsForUser(userId, tx);
      const leaderboardIds = await repo.listLeaderboardIdsForUser(userId, tx);
      const totals = { totalPoints, courseCompletionsCount };
      const [keepId, ...duplicates] = leaderboardIds;
      if (keepId === undefined) {
        await repo.insertLeaderboard(userId, totals, tx);
        return totals;
      }
      await repo.updateLeaderboardTotals(keepId, totals, tx);
      if (duplicates.length > 0) {
        await repo.deleteOtherLeaderboardRows(userId, keepId, tx);
      }
      return totals;
    });
  }

  /** §02 forward hook: aggregate summary for F2 profile / F8 analytics. */
  async getGamificationSummary(userId: number): Promise<GamificationSummary> {
    const [balance, leaderboard, badgeCount, achievementCount, certificateCount] = await Promise.all([
      this.deps.repo.getBalance(userId),
      this.deps.repo.findLeaderboardForUser(userId),
      this.deps.repo.countUserBadges(userId),
      this.deps.repo.countUserAchievements(userId),
      this.deps.repo.countUserCertificates(userId),
    ]);
    return {
      userId,
      totalPoints: balance.balance,
      globalRank: leaderboard?.globalRank ?? null,
      countryRank: leaderboard?.countryRank ?? null,
      badgeCount,
      achievementCount,
      certificateCount,
    };
  }
}

export const leaderboardService = new LeaderboardService();
