import { and, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { skills, userSkills } from '../../../app/database/schema';
import type { SkillDto, UserSkillDto } from '../dto/user.dto';

export interface IUserSkillRepository {
  listMySkills(userId: number): Promise<UserSkillDto[]>;
  findByUserAndSkill(userId: number, skillId: number): Promise<UserSkillDto | null>;
  addSkill(
    userId: number,
    skillId: number,
    proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert',
    yearsExperience: number,
  ): Promise<UserSkillDto>;
  removeSkill(userId: number, skillId: number): Promise<void>;
  findCatalogSkill(skillId: number): Promise<SkillDto | null>;
}

export class UserSkillRepository implements IUserSkillRepository {
  async listMySkills(userId: number): Promise<UserSkillDto[]> {
    const rows = await db.query.userSkills.findMany({
      where: eq(userSkills.userId, userId),
      with: { skill: true },
    });

    return rows.map((row) => ({
      skillId: row.skillId,
      skillName: row.skill.skillName,
      category: row.skill.category,
      proficiencyLevel: row.proficiencyLevel,
      yearsExperience: Number(row.yearsExperience),
      isVerified: row.isVerified,
    }));
  }

  async findByUserAndSkill(userId: number, skillId: number): Promise<UserSkillDto | null> {
    const row = await db.query.userSkills.findFirst({
      where: and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)),
      with: { skill: true },
    });

    if (!row) {
      return null;
    }

    return {
      skillId: row.skillId,
      skillName: row.skill.skillName,
      category: row.skill.category,
      proficiencyLevel: row.proficiencyLevel,
      yearsExperience: Number(row.yearsExperience),
      isVerified: row.isVerified,
    };
  }

  async addSkill(
    userId: number,
    skillId: number,
    proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert',
    yearsExperience: number,
  ): Promise<UserSkillDto> {
    await db.insert(userSkills).values({
      userId,
      skillId,
      proficiencyLevel,
      yearsExperience: yearsExperience.toFixed(1),
    });

    const created = await this.findByUserAndSkill(userId, skillId);
    if (!created) {
      throw new Error('Skill mapping insert failed.');
    }
    return created;
  }

  async removeSkill(userId: number, skillId: number): Promise<void> {
    await db
      .delete(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));
  }

  async findCatalogSkill(skillId: number): Promise<SkillDto | null> {
    const skill = await db.query.skills.findFirst({
      where: and(eq(skills.skillId, skillId), eq(skills.isActive, true)),
    });

    if (!skill) {
      return null;
    }

    return {
      skillId: skill.skillId,
      skillName: skill.skillName,
      category: skill.category,
      description: skill.description,
    };
  }
}

export const userSkillRepository = new UserSkillRepository();