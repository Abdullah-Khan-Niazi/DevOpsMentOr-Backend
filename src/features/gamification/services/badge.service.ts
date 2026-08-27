import { NotFoundError } from '../../../shared/errors';
import type { BadgeDto, BadgeType } from '../dto/gamification.dto';
import type { BadgeRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface BadgeServiceDeps {
  repo: Pick<GamificationRepository, 'listBadges' | 'findBadge'>;
}

function defaultDeps(): BadgeServiceDeps {
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

/**
 * F7 badge catalog read service (GAM-02/03). Hidden badges are never returned
 * to learners (invariant 8); the admin variants include them.
 */
export class BadgeService {
  constructor(private readonly deps: BadgeServiceDeps = defaultDeps()) {}

  async listBadges(): Promise<BadgeDto[]> {
    const rows = await this.deps.repo.listBadges(false);
    return rows.map(toDto);
  }

  async getBadgeDetail(badgeId: number): Promise<BadgeDto> {
    const badge = await this.deps.repo.findBadge(badgeId);
    if (!badge || badge.isHidden) {
      throw new NotFoundError('Badge not found.');
    }
    return toDto(badge);
  }

  /** Admin catalog read (includes hidden badges). */
  async listBadgesForAdmin(): Promise<BadgeDto[]> {
    const rows = await this.deps.repo.listBadges(true);
    return rows.map(toDto);
  }
}

export const badgeService = new BadgeService();
