import { and, count, desc, eq, inArray, like } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  organizations,
  roles,
  systemSettings,
  userRoles,
  userSettings,
  users,
} from '../../../app/database/schema';
import { ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { getSkipTake } from '../../../shared/utils';
import type {
  AdminOrgListDto,
  OrgAdminDetailDto,
  OrganizationDto,
} from '../dto/org.dto';

export interface OrgRow {
  organizationId: number;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  industry: string | null;
  isVerified: boolean;
  billingEmail: string | null;
  createdAt: Date;
}

export interface IOrgRepository {
  create(input: {
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    website: string | null;
    industry: string | null;
    billingEmail: string | null;
    isVerified: boolean;
  }): Promise<number>;
  findBySlug(slug: string): Promise<OrgRow | null>;
  findById(orgId: number): Promise<OrgRow | null>;
  listAdmin(page: number, pageSize: number, search: string | undefined): Promise<AdminOrgListDto>;
  getAdminDetail(orgId: number): Promise<OrgAdminDetailDto | null>;
  update(
    orgId: number,
    fields: Partial<
      Pick<OrganizationDto, 'name' | 'description' | 'logoUrl' | 'website' | 'industry' | 'billingEmail'>
    >,
  ): Promise<void>;
  findUserById(userId: number): Promise<{ userId: number; email: string; fullName: string | null } | null>;
  findUserByEmail(email: string): Promise<{ userId: number; email: string; fullName: string | null } | null>;
  findUsersByIds(
    userIds: number[],
  ): Promise<Array<{ userId: number; email: string; fullName: string | null }>>;
  hasRole(userId: number, roleName: string): Promise<boolean>;
  findRoleId(roleName: string): Promise<number>;
  assignRole(userId: number, roleId: number): Promise<void>;
  getEmailDomain(orgId: number): Promise<string | null>;
  setEmailDomain(orgId: number, domain: string, updatedBy: number): Promise<void>;
}

function toDto(row: OrgRow): OrganizationDto {
  return {
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logoUrl: row.logoUrl,
    website: row.website,
    industry: row.industry,
    isVerified: row.isVerified,
    billingEmail: row.billingEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

export class OrgRepository implements IOrgRepository {
  async create(input: {
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    website: string | null;
    industry: string | null;
    billingEmail: string | null;
    isVerified: boolean;
  }): Promise<number> {
    const inserted = await db.insert(organizations).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create organization.');
    }
    return id;
  }

  async findBySlug(slug: string): Promise<OrgRow | null> {
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(orgId: number): Promise<OrgRow | null> {
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.organizationId, orgId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listAdmin(
    page: number,
    pageSize: number,
    search: string | undefined,
  ): Promise<AdminOrgListDto> {
    const filters = search ? like(organizations.name, `%${search}%`) : undefined;
    const totalRows = await db.select({ value: count() }).from(organizations).where(filters);
    const total = totalRows[0]?.value ?? 0;
    const { skip, take } = getSkipTake(page, pageSize);

    const rows = await db
      .select()
      .from(organizations)
      .where(filters)
      .orderBy(desc(organizations.createdAt))
      .limit(take)
      .offset(skip);

    return {
      data: rows.map(toDto),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAdminDetail(orgId: number): Promise<OrgAdminDetailDto | null> {
    const orgRows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.organizationId, orgId))
      .limit(1);
    const org = orgRows[0];
    if (!org) {
      return null;
    }

    const adminRows = await db
      .select({ userId: users.userId, email: users.email, fullName: users.fullName })
      .from(userRoles)
      .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
      .innerJoin(users, eq(users.userId, userRoles.userId))
      .where(eq(roles.roleName, ROLES.ORG_ADMIN))
      .limit(10);

    for (const candidate of adminRows) {
      const scope = await this.getScope(candidate.userId);
      if (scope === orgId) {
        return {
          ...toDto(org),
          adminUserId: candidate.userId,
          adminEmail: candidate.email,
        };
      }
    }

    return { ...toDto(org), adminUserId: null, adminEmail: null };
  }

  private async getScope(userId: number): Promise<number | null> {
    const rows = await db
      .select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(and(
        eq(userSettings.userId, userId),
        eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
      ))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async update(
    orgId: number,
    fields: Partial<
      Pick<OrganizationDto, 'name' | 'description' | 'logoUrl' | 'website' | 'industry' | 'billingEmail'>
    >,
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (fields.name !== undefined) patch.name = fields.name;
    if ('description' in fields) patch.description = fields.description;
    if ('logoUrl' in fields) patch.logoUrl = fields.logoUrl;
    if ('website' in fields) patch.website = fields.website;
    if ('industry' in fields) patch.industry = fields.industry;
    if ('billingEmail' in fields) patch.billingEmail = fields.billingEmail;
    await db.update(organizations).set(patch).where(eq(organizations.organizationId, orgId));
  }

  async findUserById(userId: number): Promise<{ userId: number; email: string; fullName: string | null } | null> {
    const rows = await db
      .select({ userId: users.userId, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserByEmail(
    email: string,
  ): Promise<{ userId: number; email: string; fullName: string | null } | null> {
    const rows = await db
      .select({ userId: users.userId, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUsersByIds(
    userIds: number[],
  ): Promise<Array<{ userId: number; email: string; fullName: string | null }>> {
    if (userIds.length === 0) {
      return [];
    }
    return db
      .select({ userId: users.userId, email: users.email, fullName: users.fullName })
      .from(users)
      .where(inArray(users.userId, userIds));
  }

  /** ORG-08: per-org enrollment email domain restriction (missing → open). */
  async getEmailDomain(orgId: number): Promise<string | null> {
    const rows = await db
      .select({ settingValue: systemSettings.settingValue })
      .from(systemSettings)
      .where(eq(systemSettings.settingKey, ORG_CONSTANTS.ORG_EMAIL_DOMAIN_KEY(orgId)))
      .limit(1);
    const raw = rows[0]?.settingValue;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  async setEmailDomain(orgId: number, domain: string, updatedBy: number): Promise<void> {
    const key = ORG_CONSTANTS.ORG_EMAIL_DOMAIN_KEY(orgId);
    await db
      .insert(systemSettings)
      .values({ settingKey: key, settingValue: domain, groupName: 'org', updatedBy })
      .onDuplicateKeyUpdate({ set: { settingValue: domain, updatedBy } });
  }

  async hasRole(userId: number, roleName: string): Promise<boolean> {
    const rows = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.roleName, roleName)))
      .limit(1);
    return rows.length > 0;
  }

  async findRoleId(roleName: string): Promise<number> {
    const rows = await db
      .select({ roleId: roles.roleId })
      .from(roles)
      .where(eq(roles.roleName, roleName))
      .limit(1);
    const roleId = rows[0]?.roleId;
    if (!roleId) {
      throw new Error(`F3 role '${roleName}' is not seeded.`);
    }
    return roleId;
  }

  async assignRole(userId: number, roleId: number): Promise<void> {
    await db
      .insert(userRoles)
      .values({ userId, roleId })
      .onDuplicateKeyUpdate({ set: { userId } });
  }
}

export const orgRepository = new OrgRepository();

/**
 * Org-scope resolution (§06 adaptation mapping): a user's single-organization
 * affiliation lives in `user_settings` under the `org_id` key. Used by the
 * org-guard middleware and the org-scoped services so no client-supplied
 * org identifier is ever trusted.
 */
export interface IOrgScopeRepository {
  getOrgId(userId: number): Promise<number | null>;
  setOrgId(userId: number, orgId: number): Promise<void>;
}

export class OrgScopeRepository implements IOrgScopeRepository {
  async getOrgId(userId: number): Promise<number | null> {
    const rows = await db
      .select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(and(
        eq(userSettings.userId, userId),
        eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
      ))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async setOrgId(userId: number, orgId: number): Promise<void> {
    await db
      .insert(userSettings)
      .values({ userId, settingKey: ORG_CONSTANTS.ORG_ID_SETTING_KEY, settingValue: orgId })
      .onDuplicateKeyUpdate({ set: { settingValue: orgId } });
  }
}

export const orgScopeRepository = new OrgScopeRepository();