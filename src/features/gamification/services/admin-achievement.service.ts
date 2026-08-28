import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { AchievementDto } from '../dto/gamification.dto';
import type { AchievementRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export type AchievementTriggerType = 'lab_completions' | 'course_completions' | 'streak_days' | 'points_balance';

export interface CreateAchievementInput {
  name: string;
  description?: string | null;
  pointsAwarded: number;
  triggerType: AchievementTriggerType;
  triggerValue: Record<string, unknown>;
  isActive: boolean;
}

export interface UpdateAchievementInput {
  name?: string;
  description?: string | null;
  pointsAwarded?: number;
  triggerType?: AchievementTriggerType;
  triggerValue?: Record<string, unknown> | null;
  isActive?: boolean;
}

export interface AdminAchievementServiceDeps {
  repo: Pick<
    GamificationRepository,
    'findAchievement' | 'findAchievementByName' | 'insertAchievement' | 'updateAchievement'
  >;
}

function defaultDeps(): AdminAchievementServiceDeps {
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

/** GAM-17/18: platform-admin achievement catalog management. */
export class AdminAchievementService {
  constructor(private readonly deps: AdminAchievementServiceDeps = defaultDeps()) {}

  async create(input: CreateAchievementInput): Promise<AchievementDto> {
    await this.assertUniqueName(input.name);
    const achievementId = await this.deps.repo.insertAchievement({
      name: input.name,
      description: input.description ?? null,
      pointsAwarded: input.pointsAwarded,
      triggerType: input.triggerType,
      triggerValue: input.triggerValue,
      isActive: input.isActive,
    });
    const created = await this.deps.repo.findAchievement(achievementId);
    if (!created) {
      throw new NotFoundError('Achievement not found.');
    }
    return toDto(created);
  }

  async update(achievementId: number, input: UpdateAchievementInput): Promise<AchievementDto> {
    const achievement = await this.deps.repo.findAchievement(achievementId);
    if (!achievement) {
      throw new NotFoundError('Achievement not found.');
    }
    if (input.name !== undefined && input.name !== achievement.name) {
      await this.assertUniqueName(input.name, achievementId);
    }
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.pointsAwarded !== undefined) patch.pointsAwarded = input.pointsAwarded;
    if (input.triggerType !== undefined) patch.triggerType = input.triggerType;
    if (input.triggerValue !== undefined) patch.triggerValue = input.triggerValue;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    await this.deps.repo.updateAchievement(achievementId, patch);
    const updated = await this.deps.repo.findAchievement(achievementId);
    if (!updated) {
      throw new NotFoundError('Achievement not found.');
    }
    return toDto(updated);
  }

  private async assertUniqueName(name: string, excludeAchievementId?: number): Promise<void> {
    const existing = await this.deps.repo.findAchievementByName(name);
    if (existing && existing.achievementId !== excludeAchievementId) {
      throw new ConflictError('An achievement with this name already exists.');
    }
  }
}

export const adminAchievementService = new AdminAchievementService();
