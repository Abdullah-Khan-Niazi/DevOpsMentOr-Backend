import { NotFoundError } from '../../../shared/errors';
import type { GamificationRepository, SeasonRow } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface SeasonServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'listSeasons'
    | 'findSeason'
    | 'findActiveSeason'
    | 'listSeasonContent'
    | 'findSeasonLeaderboardRow'
  >;
}

function defaultDeps(): SeasonServiceDeps {
  return { repo: gamificationRepository };
}

/** Season content item as returned by the repository. */
export interface SeasonContentItem {
  contentType: string;
  contentId: number;
  releaseOrder: number;
  isReleased: boolean;
  releasedAt: Date | null;
}

export interface SeasonDetailDto {
  seasonId: number;
  seasonName: string;
  seasonNumber: number;
  description: string | null;
  bannerUrl: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
  content: Array<{
    contentType: string;
    contentId: number;
    releaseOrder: number;
    isReleased: boolean;
    releasedAt: string | null;
  }>;
}

function toDetail(season: SeasonRow, content: SeasonContentItem[]): SeasonDetailDto {
  return {
    seasonId: season.seasonId,
    seasonName: season.seasonName,
    seasonNumber: season.seasonNumber,
    description: season.description,
    bannerUrl: season.bannerUrl,
    startDate: season.startDate,
    endDate: season.endDate,
    isActive: season.isActive,
    content: content.map((item) => ({
      contentType: item.contentType,
      contentId: item.contentId,
      releaseOrder: item.releaseOrder,
      isReleased: item.isReleased,
      releasedAt: item.releasedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * F7 season catalog service (read paths). Season points and ranks are owned by
 * the leaderboard computation job; `getSeasonPoints` feeds it and the admin
 * points service.
 */
export class SeasonService {
  constructor(private readonly deps: SeasonServiceDeps = defaultDeps()) {}

  /** GAM-11: season catalog ordered by season number (most recent first). */
  async listSeasons(): Promise<SeasonRow[]> {
    return this.deps.repo.listSeasons();
  }

  /** GAM-12: season detail with its assigned content. */
  async getSeasonDetail(seasonId: number): Promise<SeasonDetailDto> {
    const season = await this.deps.repo.findSeason(seasonId);
    if (!season) {
      throw new NotFoundError('Season not found.');
    }
    const content = await this.deps.repo.listSeasonContent(seasonId);
    return toDetail(season, content);
  }

  /** Active season detection for the season leaderboard entry point. */
  async getActiveSeason(): Promise<SeasonRow | null> {
    return this.deps.repo.findActiveSeason();
  }
}

export const seasonService = new SeasonService();
