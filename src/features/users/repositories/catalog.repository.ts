import { asc, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { skills, countries } from '../../../app/database/schema';
import type { CountryDto, SkillDto } from '../dto/user.dto';

export interface ISkillCatalogRepository {
  listActive(): Promise<SkillDto[]>;
}

export class SkillCatalogRepository implements ISkillCatalogRepository {
  async listActive(): Promise<SkillDto[]> {
    const rows = await db
      .select()
      .from(skills)
      .where(eq(skills.isActive, true))
      .orderBy(asc(skills.skillName));

    return rows.map((skill) => ({
      skillId: skill.skillId,
      skillName: skill.skillName,
      category: skill.category,
      description: skill.description,
    }));
  }
}

export const skillCatalogRepository = new SkillCatalogRepository();

export interface ICountryRepository {
  listActive(): Promise<CountryDto[]>;
}

export class CountryRepository implements ICountryRepository {
  async listActive(): Promise<CountryDto[]> {
    const rows = await db
      .select()
      .from(countries)
      .where(eq(countries.isActive, true))
      .orderBy(asc(countries.countryName));

    return rows.map((country) => ({
      countryId: country.countryId,
      countryCode: country.countryCode,
      countryName: country.countryName,
      phoneCode: country.phoneCode,
      flagEmoji: country.flagEmoji,
    }));
  }
}

export const countryRepository = new CountryRepository();