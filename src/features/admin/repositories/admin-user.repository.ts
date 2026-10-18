import { and, asc, countDistinct, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  countries,
  loginHistory,
  organizations,
  roles,
  teamMembers,
  teams,
  userFollows,
  userProfiles,
  userRoles,
  userSettings,
  users,
} from '../../../app/database/schema';
import { ORG_CONSTANTS, ROLES } from '../../../shared/constants';
import { getSkipTake } from '../../../shared/utils';
import type { AdminListFilter, AdminUserDetailDto, PlatformAdminDto } from '../dto/admin.dto';

export interface AdminUserRow {
  userId: number;
  email: string;
  username: string;
  fullName: string | null;
  isActive: boolean;
  isBanned: boolean;
  isVerified: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  organizationId?: number | null;
  organizationName?: string | null;
  country?: string | null;
}

export interface IAdminUserRepository {
  list(filter: AdminListFilter): Promise<{ data: AdminUserRow[]; rolesByUser: Map<number, string[]>; total: number }>;
  findDetail(userId: number): Promise<AdminUserDetailDto | null>;
  findUserRoles(userId: number): Promise<string[]>;
  setBan(userId: number, isBanned: boolean, banReason: string | null): Promise<void>;
  softDelete(userId: number): Promise<void>;
  restore(userId: number): Promise<void>;
  listPlatformAdmins(): Promise<PlatformAdminDto[]>;
}

export class AdminUserRepository implements IAdminUserRepository {
  async list(
    filter: AdminListFilter,
  ): Promise<{ data: AdminUserRow[]; rolesByUser: Map<number, string[]>; total: number }> {
    const conditions = [];

    if (filter.search) {
      const term = `%${filter.search}%`;
      conditions.push(or(like(users.email, term), like(users.username, term), like(users.fullName, term)));
    }
    if (filter.isBanned !== undefined) {
      conditions.push(eq(users.isBanned, filter.isBanned));
    }
    if (filter.isActive !== undefined) {
      conditions.push(eq(users.isActive, filter.isActive));
    }
    if (filter.isDeleted !== undefined) {
      conditions.push(filter.isDeleted ? isNotNull(users.deletedAt) : isNull(users.deletedAt));
    }
    if (filter.organizationId !== undefined) {
      const orgIdStr = String(filter.organizationId);
      conditions.push(
        or(
          inArray(
            users.userId,
            db
              .select({ userId: userSettings.userId })
              .from(userSettings)
              .where(
                and(
                  eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
                  sql`JSON_UNQUOTE(${userSettings.settingValue}) = ${orgIdStr}`,
                ),
              ),
          ),
          inArray(
            users.userId,
            db
              .select({ userId: teams.teamOwnerId })
              .from(teams)
              .where(eq(teams.organizationId, filter.organizationId)),
          ),
          inArray(
            users.userId,
            db
              .select({ userId: teamMembers.userId })
              .from(teamMembers)
              .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
              .where(
                and(
                  eq(teams.organizationId, filter.organizationId),
                  eq(teamMembers.isActive, true),
                ),
              ),
          ),
        ),
      );
    }
    if (filter.country) {
      conditions.push(
        inArray(
          users.userId,
          db
            .select({ userId: userProfiles.userId })
            .from(userProfiles)
            .innerJoin(countries, eq(countries.countryId, userProfiles.countryId))
            .where(
              or(
                eq(countries.countryCode, filter.country),
                like(countries.countryName, `%${filter.country}%`),
              ),
            ),
        ),
      );
    }

    // Admin views include soft-deleted users (F2 §05 invariant 6); no
    // deleted_at filter is applied by default unless requested. Role filtering
    // participates in the WHERE clause and in the count query.
    const roleCondition = filter.role ? eq(roles.roleName, filter.role) : undefined;

    const totalRow = await db
      .select({ value: countDistinct(users.userId) })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.userId))
      .leftJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(and(...conditions, roleCondition));

    const { skip, take } = getSkipTake(filter.page, filter.pageSize);
    const rows = await db
      .select({
        userId: users.userId,
        email: users.email,
        username: users.username,
        fullName: users.fullName,
        isActive: users.isActive,
        isBanned: users.isBanned,
        isVerified: users.isVerified,
        createdAt: users.createdAt,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.userId))
      .leftJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(and(...conditions, roleCondition))
      .groupBy(users.userId)
      .orderBy(desc(users.createdAt))
      .limit(take)
      .offset(skip);

    const userIds = rows.map((row) => row.userId);
    const rolesByUser = new Map<number, string[]>();
    const orgByUser = new Map<number, { id: number; name: string }>();
    const countryByUser = new Map<number, string>();

    if (userIds.length > 0) {
      const [roleRows, orgSettingsRows, profileRows] = await Promise.all([
        db
          .select({ userId: userRoles.userId, roleName: roles.roleName })
          .from(userRoles)
          .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
          .where(inArray(userRoles.userId, userIds)),
        db
          .select({
            userId: userSettings.userId,
            orgId: sql<string>`JSON_UNQUOTE(${userSettings.settingValue})`,
          })
          .from(userSettings)
          .where(
            and(
              inArray(userSettings.userId, userIds),
              eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
            ),
          ),
        db
          .select({
            userId: userProfiles.userId,
            countryName: countries.countryName,
            countryCode: countries.countryCode,
          })
          .from(userProfiles)
          .leftJoin(countries, eq(countries.countryId, userProfiles.countryId))
          .where(inArray(userProfiles.userId, userIds)),
      ]);

      for (const row of roleRows) {
        const current = rolesByUser.get(row.userId) ?? [];
        current.push(row.roleName);
        rolesByUser.set(row.userId, current);
      }

      for (const p of profileRows) {
        if (p.countryName || p.countryCode) {
          countryByUser.set(p.userId, p.countryName ?? p.countryCode ?? '');
        }
      }

      const orgIds = orgSettingsRows
        .map((r) => Number(r.orgId))
        .filter((id) => !Number.isNaN(id) && id > 0);

      if (orgIds.length > 0) {
        const orgsList = await db
          .select({ id: organizations.organizationId, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.organizationId, orgIds));
        const orgMap = new Map(orgsList.map((o) => [o.id, o.name]));
        for (const s of orgSettingsRows) {
          const orgId = Number(s.orgId);
          if (orgMap.has(orgId)) {
            orgByUser.set(s.userId, { id: orgId, name: orgMap.get(orgId)! });
          }
        }
      }

      // Also enrich any users with teams/classes linked to organizations
      const missingOrgUserIds = userIds.filter((id) => !orgByUser.has(id));
      if (missingOrgUserIds.length > 0) {
        const [orgTeamsList, orgMemberList] = await Promise.all([
          db
            .select({
              userId: teams.teamOwnerId,
              orgId: teams.organizationId,
              orgName: organizations.name,
            })
            .from(teams)
            .innerJoin(organizations, eq(organizations.organizationId, teams.organizationId))
            .where(and(inArray(teams.teamOwnerId, missingOrgUserIds), isNotNull(teams.organizationId))),
          db
            .select({
              userId: teamMembers.userId,
              orgId: teams.organizationId,
              orgName: organizations.name,
            })
            .from(teamMembers)
            .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
            .innerJoin(organizations, eq(organizations.organizationId, teams.organizationId))
            .where(
              and(
                inArray(teamMembers.userId, missingOrgUserIds),
                isNotNull(teams.organizationId),
                eq(teamMembers.isActive, true),
              ),
            ),
        ]);
        for (const t of orgTeamsList) {
          if (t.userId && t.orgId && !orgByUser.has(t.userId)) {
            orgByUser.set(t.userId, { id: t.orgId, name: t.orgName });
          }
        }
        for (const m of orgMemberList) {
          if (m.userId && m.orgId && !orgByUser.has(m.userId)) {
            orgByUser.set(m.userId, { id: m.orgId, name: m.orgName });
          }
        }
      }
    }

    const data: AdminUserRow[] = rows.map((row) => ({
      ...row,
      organizationId: orgByUser.get(row.userId)?.id ?? null,
      organizationName: orgByUser.get(row.userId)?.name ?? null,
      country: countryByUser.get(row.userId) ?? null,
    }));

    return {
      data,
      rolesByUser,
      total: totalRow[0]?.value ?? 0,
    };
  }

  async findDetail(userId: number): Promise<AdminUserDetailDto | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.userId, userId),
      with: {
        roles: { with: { role: true } },
        profile: { with: { country: true } },
        skills: { with: { skill: true } },
      },
    });

    if (!user) {
      return null;
    }

    const loginRows = await db
      .select()
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(20);

    const [followersRow, followingRow] = await Promise.all([
      db
        .select({ value: countDistinct(userFollows.followerId) })
        .from(userFollows)
        .where(eq(userFollows.followingId, userId)),
      db
        .select({ value: countDistinct(userFollows.followingId) })
        .from(userFollows)
        .where(eq(userFollows.followerId, userId)),
    ]);

    return {
      userId: user.userId,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      isBanned: user.isBanned,
      isVerified: user.isVerified,
      banReason: user.banReason,
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      roles: user.roles.map((r) => r.role.roleName),
      profile: user.profile
        ? {
            occupation: user.profile.occupation,
            company: user.profile.company,
            website: user.profile.website,
            githubUrl: user.profile.githubUrl,
            linkedinUrl: user.profile.linkedinUrl,
            twitterHandle: user.profile.twitterHandle,
            discordUsername: user.profile.discordUsername,
            reputationScore: user.profile.reputationScore,
            profileViews: user.profile.profileViews,
            isPublic: user.profile.isPublic,
            country: user.profile.country
              ? { countryId: user.profile.country.countryId, countryName: user.profile.country.countryName }
              : null,
          }
        : null,
      skills: user.skills.map((s) => ({
        skillId: s.skillId,
        skillName: s.skill.skillName,
        category: s.skill.category,
        proficiencyLevel: s.proficiencyLevel,
        yearsExperience: Number(s.yearsExperience),
        isVerified: s.isVerified,
      })),
      loginHistory: loginRows.map((row) => ({
        loginId: row.loginId,
        loginType: row.loginType,
        isSuccessful: row.isSuccessful,
        failureReason: row.failureReason,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      followersCount: followersRow[0]?.value ?? 0,
      followingCount: followingRow[0]?.value ?? 0,
    };
  }

  async findUserRoles(userId: number): Promise<string[]> {
    const rows = await db
      .select({ roleName: roles.roleName })
      .from(userRoles)
      .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(eq(userRoles.userId, userId));

    return rows.map((row) => row.roleName);
  }

  async setBan(userId: number, isBanned: boolean, banReason: string | null): Promise<void> {
    await db.update(users).set({ isBanned, banReason }).where(eq(users.userId, userId));
  }

  async softDelete(userId: number): Promise<void> {
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.userId, userId));
  }

  async restore(userId: number): Promise<void> {
    await db.update(users).set({ deletedAt: null }).where(eq(users.userId, userId));
  }

  async listPlatformAdmins(): Promise<PlatformAdminDto[]> {
    const rows = await db
      .select({
        userId: users.userId,
        email: users.email,
        username: users.username,
        fullName: users.fullName,
        isActive: users.isActive,
        isBanned: users.isBanned,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.userId))
      .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
      .where(and(eq(roles.roleName, ROLES.PLATFORM_ADMIN), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt));

    return rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      username: row.username,
      fullName: row.fullName,
      isActive: row.isActive,
      isBanned: row.isBanned,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

export const adminUserRepository = new AdminUserRepository();