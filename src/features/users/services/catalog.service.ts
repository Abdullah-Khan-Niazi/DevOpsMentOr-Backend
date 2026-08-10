import type { CountryDto, SkillDto } from '../dto/user.dto';
import type { ICountryRepository, ISkillCatalogRepository } from '../repositories/catalog.repository';
import { countryRepository, skillCatalogRepository } from '../repositories/catalog.repository';

export class SkillService {
  constructor(private readonly catalog: ISkillCatalogRepository = skillCatalogRepository) {}

  async list(): Promise<SkillDto[]> {
    return this.catalog.listActive();
  }
}

export const skillService = new SkillService();

export class CountryService {
  constructor(private readonly catalog: ICountryRepository = countryRepository) {}

  async list(): Promise<CountryDto[]> {
    return this.catalog.listActive();
  }
}

export const countryService = new CountryService();