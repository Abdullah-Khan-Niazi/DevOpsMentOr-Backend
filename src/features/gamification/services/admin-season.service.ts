import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { GamificationRepository, SeasonRow } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface SeasonContentInput {
  contentType: 'lab';
  contentId: number;
  releaseOrder: number;
  isReleased: boolean;
}

export interface CreateSeasonInput {
  seasonName: string;
  seasonNumber: number;
  description?: string | null;
  bannerUrl?: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface UpdateSeasonInput {
  seasonName?: string;
  seasonNumber?: number;
  description?: string | null;
  bannerUrl?: string | null;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  content?: SeasonContentInput[];
}

export interface AdminSeasonServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'findSeason'
    | 'findOverlappingSeasons'
    | 'insertSeason'
    | 'updateSeason'
    | 'replaceSeasonContent'
    | 'labExists'
  >;
}

function defaultDeps(): AdminSeasonServiceDeps {
  return { repo: gamificationRepository };
}

function toDto(season: SeasonRow): {
  seasonId: number;
  seasonName: string;
  seasonNumber: number;
  description: string | null;
  bannerUrl: string | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
} {
  return {
    seasonId: season.seasonId,
    seasonName: season.seasonName,
    seasonNumber: season.seasonNumber,
    description: season.description,
    bannerUrl: season.bannerUrl,
    startDate: season.startDate,
    endDate: season.endDate,
    isActive: season.isActive,
  };
}

/** GAM-19/20: platform-admin season management + season_content assignment. */
export class AdminSeasonService {
  constructor(private readonly deps: AdminSeasonServiceDeps = defaultDeps()) {}

  async create(input: CreateSeasonInput): Promise<ReturnType<typeof toDto>> {
    await this.assertNoOverlap(input.startDate, input.endDate);
    const seasonId = await this.deps.repo.insertSeason({
      seasonName: input.seasonName,
      seasonNumber: input.seasonNumber,
      description: input.description ?? null,
      bannerUrl: input.bannerUrl ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      isActive: input.isActive,
    });
    const created = await this.deps.repo.findSeason(seasonId);
    if (!created) {
      throw new NotFoundError('Season not found.');
    }
    return toDto(created);
  }

  async update(seasonId: number, input: UpdateSeasonInput): Promise<ReturnType<typeof toDto>> {
    const season = await this.deps.repo.findSeason(seasonId);
    if (!season) {
      throw new NotFoundError('Season not found.');
    }
    const startDate = input.startDate ?? season.startDate;
    const endDate = input.endDate ?? season.endDate;
    if (input.startDate !== undefined || input.endDate !== undefined) {
      await this.assertNoOverlap(startDate, endDate, seasonId);
    }
    const patch: Record<string, unknown> = {};
    if (input.seasonName !== undefined) patch.seasonName = input.seasonName;
    if (input.seasonNumber !== undefined) patch.seasonNumber = input.seasonNumber;
    if (input.description !== undefined) patch.description = input.description;
    if (input.bannerUrl !== undefined) patch.bannerUrl = input.bannerUrl;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.endDate !== undefined) patch.endDate = input.endDate;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    await this.deps.repo.updateSeason(seasonId, patch);

    if (input.content !== undefined) {
      await this.validateContent(input.content);
      await this.deps.repo.replaceSeasonContent(
        seasonId,
        input.content.map((item) => ({
          contentType: item.contentType,
          contentId: item.contentId,
          releaseOrder: item.releaseOrder,
          isReleased: item.isReleased,
        })),
      );
    }

    const updated = await this.deps.repo.findSeason(seasonId);
    if (!updated) {
      throw new NotFoundError('Season not found.');
    }
    return toDto(updated);
  }

  private async assertNoOverlap(startDate: string, endDate: string, excludeSeasonId?: number): Promise<void> {
    const overlapping = await this.deps.repo.findOverlappingSeasons(startDate, endDate, excludeSeasonId);
    if (overlapping.length > 0) {
      throw new ConflictError('Season dates overlap with an existing season.');
    }
  }

  private async validateContent(items: SeasonContentInput[]): Promise<void> {
    for (const item of items) {
      if (item.contentType === 'lab' && !(await this.deps.repo.labExists(item.contentId))) {
        throw new NotFoundError(`Lab #${item.contentId} does not exist.`);
      }
    }
  }
}

export const adminSeasonService = new AdminSeasonService();
