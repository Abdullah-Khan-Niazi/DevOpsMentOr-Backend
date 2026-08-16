import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { ROLES } from '../../../shared/constants';
import type { GamificationSummary, LeaderboardEntryDto } from '../dto/gamification.dto';
import type { GamificationRepository, LeaderboardEntryLike, SeasonLeaderboardRow } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

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
    | 'getOrgId'
    | 'listClassStudentIds'
    | 'listOrgMemberIds'
    | 'findLeaderboardForUser'
    | 'getBalance'
    | 'countUserBadges'
    | 'countUserAchievements'
    | 'countUserCertificates'
  >;
}

function defaultDeps(): LeaderboardServiceDeps {
  return { repo: gamificationRepository };
}

function toEntry(row: LeaderboardEntryLike): LeaderboardEntryDto {
  return {
    leaderboardId: row.leaderboardId,
    userId: row.userId,
    fullName: row.fullName,
    displayName: row.displayName,
    totalPoints: row.totalPoints,
    globalRank: row.globalRank,
    countryRank: row.countryRank,
    countryCode: row.countryCode,
  };
}

function toSeasonEntry(row: SeasonLeaderboardRow): {
  leaderboardId: number;
  userId: number;
  pointsEarned: number;
  rank: number | null;
  fullName: string | null;
  displayName: string | null;
} {
  return {
    leaderboardId: row.leaderboardId,
    userId: row.userId,
    pointsEarned: row.pointsEarned,
    rank: row.rank,
    fullName: row.fullName,
    displayName: row.displayName,
  };
}

function isPlatformAdmin(actor: GamificationActor): boolean {
  return actor.roles.includes(ROLES.PLATFORM_ADMIN);
}

function isOrgAdmin(actor: GamificationActor): boolean {
  return actor.roles.includes(ROLES.ORG_ADMIN);
}

/**
 * F7 leaderboard service. Global/country/season views are public reads over
 * the recomputed `leaderboards` / `season_leaderboards` snapshots; class/org
 * views are scoped cohorts resolved from the session (BOLA: membership is
 * verified server-side, never taken from the request body).
 */
export class LeaderboardService {
  constructor(private readonly deps: LeaderboardServiceDeps = defaultDeps()) {}

  /** GAM-06: paginated global leaderboard with the viewer's own rank. */
  async getGlobal(
    page: number,
    limit: number,
    viewerUserId: number | null,
  ): Promise<PaginatedLeaderboard<LeaderboardEntryDto>> {
    const { rows, total } = await this.deps.repo.getGlobalLeaderboard(page, limit);
    const viewerRank = viewerUserId !== null ? await this.viewerRank(viewerUserId) : null;
    return { items: rows.map(toEntry), total, page, limit, viewerRank };
  }

  /** GAM-07: paginated country-scoped leaderboard. */
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
    const viewerRank = viewerUserId !== null ? await this.viewerRank(viewerUserId) : null;
    return { items: rows.map(toEntry), total, page, limit, viewerRank };
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
    if (viewerUserId !== null) {
      const own = await this.deps.repo.findSeasonLeaderboardRow(seasonId, viewerUserId);
      viewerRank = own?.rank ?? null;
    }
    return { items: rows.map(toSeasonEntry), total, page, limit, viewerRank };
  }

  /** GAM-09: class-scoped leaderboard for the assigned professor / org admin. */
  async getClass(
    classId: number,
    actor: GamificationActor,
  ): Promise<{ className: string; items: LeaderboardEntryDto[]; total: number }> {
    const cls = await this.deps.repo.findClass(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }
    const orgId = await this.deps.repo.getOrgId(actor.userId);
    const isProfessor = await this.deps.repo.isProfessorOfClass(classId, actor.userId);
    const orgScoped = isOrgAdmin(actor) && orgId !== null && cls.organizationId !== null && orgId === cls.organizationId;
    if (!isPlatformAdmin(actor) && !isProfessor && !orgScoped) {
      throw new ForbiddenError('You do not have access to this class.');
    }
    const userIds = await this.deps.repo.listClassStudentIds(classId);
    const rows = await this.deps.repo.getLeaderboardForUsers(userIds);
    return { className: cls.className, items: rows.map(toEntry), total: rows.length };
  }

  /** GAM-10: org-scoped leaderboard for the org admin / platform admin. */
  async getOrg(
    orgId: number,
    actor: GamificationActor,
  ): Promise<{ items: LeaderboardEntryDto[]; total: number }> {
    if (!isPlatformAdmin(actor)) {
      const callerOrgId = await this.deps.repo.getOrgId(actor.userId);
      if (!isOrgAdmin(actor) || callerOrgId !== orgId) {
        throw new ForbiddenError('You do not have access to this organization.');
      }
    }
    const userIds = await this.deps.repo.listOrgMemberIds(orgId);
    const rows = await this.deps.repo.getLeaderboardForUsers(userIds);
    return { items: rows.map(toEntry), total: rows.length };
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

  private async viewerRank(userId: number): Promise<number | null> {
    const row = await this.deps.repo.findLeaderboardForUser(userId);
    return row?.globalRank ?? null;
  }
}

export const leaderboardService = new LeaderboardService();
