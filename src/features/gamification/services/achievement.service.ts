import type { AchievementDto } from '../dto/gamification.dto';
import type { AchievementRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface AchievementServiceDeps {
  repo: Pick<GamificationRepository, 'listActiveAchievements' | 'listAchievementsForAdmin'>;
}

function defaultDeps(): AchievementServiceDeps {
  return { repo: gamificationRepository };
}

function toDto(achievement: AchievementRow): AchievementDto {
  return {
    achievementId: achievement.achievementId,
    name: achievement.name,
    description: achievement.description,
    pointsAwarded: achievement.pointsAwarded,
    triggerType: achievement.triggerType,
    isActive: achievement.isActive,
    createdAt: achievement.createdAt.toISOString(),
  };
}

/**
 * F7 achievement catalog read service (GAM-04). Learners only see active
 * achievements; the admin variant lists the full catalog.
 */
export class AchievementService {
  constructor(private readonly deps: AchievementServiceDeps = defaultDeps()) {}

  async listAchievements(): Promise<AchievementDto[]> {
    const rows = await this.deps.repo.listActiveAchievements();
    return rows.map(toDto);
  }

  /** Admin catalog read (includes inactive achievements). */
  async listAchievementsForAdmin(): Promise<AchievementDto[]> {
    const rows = await this.deps.repo.listAchievementsForAdmin();
    return rows.map(toDto);
  }
}

export const achievementService = new AchievementService();
