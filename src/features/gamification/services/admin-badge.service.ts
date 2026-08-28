import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { BadgeCriteria, BadgeDto, BadgeType } from '../dto/gamification.dto';
import type { BadgeRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface CreateBadgeInput {
  badgeName: string;
  slug: string;
  description?: string | null;
  badgeType: BadgeType;
  iconUrl?: string | null;
  pointsRequired: number;
  criteria?: BadgeCriteria | null;
  isHidden: boolean;
}

export interface UpdateBadgeInput {
  badgeName?: string;
  slug?: string;
  description?: string | null;
  badgeType?: BadgeType;
  iconUrl?: string | null;
  pointsRequired?: number;
  criteria?: BadgeCriteria | null;
  isHidden?: boolean;
}

export interface AdminBadgeServiceDeps {
  repo: Pick<
    GamificationRepository,
    'findBadge' | 'findBadgeByName' | 'findBadgeBySlug' | 'insertBadge' | 'updateBadge'
  >;
}

function defaultDeps(): AdminBadgeServiceDeps {
  return { repo: gamificationRepository };
}

function toDto(badge: BadgeRow): BadgeDto {
  return {
    badgeId: badge.badgeId,
    badgeName: badge.badgeName,
    slug: badge.slug,
    description: badge.description,
    badgeType: badge.badgeType as BadgeType,
    iconUrl: badge.iconUrl,
    pointsRequired: badge.pointsRequired,
    isHidden: badge.isHidden,
    createdAt: badge.createdAt.toISOString(),
  };
}

/** GAM-15/16: platform-admin badge catalog management. */
export class AdminBadgeService {
  constructor(private readonly deps: AdminBadgeServiceDeps = defaultDeps()) {}

  async create(input: CreateBadgeInput): Promise<BadgeDto> {
    await this.assertUnique(input.badgeName, input.slug);
    const badgeId = await this.deps.repo.insertBadge({
      badgeName: input.badgeName,
      slug: input.slug,
      description: input.description ?? null,
      badgeType: input.badgeType,
      iconUrl: input.iconUrl ?? null,
      pointsRequired: input.pointsRequired,
      criteria: input.criteria ?? null,
      isHidden: input.isHidden,
    });
    const created = await this.deps.repo.findBadge(badgeId);
    if (!created) {
      throw new NotFoundError('Badge not found.');
    }
    return toDto(created);
  }

  async update(badgeId: number, input: UpdateBadgeInput): Promise<BadgeDto> {
    const badge = await this.deps.repo.findBadge(badgeId);
    if (!badge) {
      throw new NotFoundError('Badge not found.');
    }
    if (input.badgeName !== undefined || input.slug !== undefined) {
      await this.assertUnique(
        input.badgeName ?? badge.badgeName,
        input.slug ?? badge.slug,
        badgeId,
      );
    }
    const patch: Record<string, unknown> = {};
    if (input.badgeName !== undefined) patch.badgeName = input.badgeName;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.badgeType !== undefined) patch.badgeType = input.badgeType;
    if (input.iconUrl !== undefined) patch.iconUrl = input.iconUrl;
    if (input.pointsRequired !== undefined) patch.pointsRequired = input.pointsRequired;
    if (input.criteria !== undefined) patch.criteria = input.criteria;
    if (input.isHidden !== undefined) patch.isHidden = input.isHidden;
    await this.deps.repo.updateBadge(badgeId, patch);
    const updated = await this.deps.repo.findBadge(badgeId);
    if (!updated) {
      throw new NotFoundError('Badge not found.');
    }
    return toDto(updated);
  }

  private async assertUnique(
    badgeName: string,
    slug: string,
    excludeBadgeId?: number,
  ): Promise<void> {
    const byName = await this.deps.repo.findBadgeByName(badgeName);
    if (byName && byName.badgeId !== excludeBadgeId) {
      throw new ConflictError('A badge with this name already exists.');
    }
    const bySlug = await this.deps.repo.findBadgeBySlug(slug);
    if (bySlug && bySlug.badgeId !== excludeBadgeId) {
      throw new ConflictError('A badge with this slug already exists.');
    }
  }
}

export const adminBadgeService = new AdminBadgeService();
