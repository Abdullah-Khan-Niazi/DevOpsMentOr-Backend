import { and, asc, countDistinct, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { db } from '../../../app/database';
import { loginHistory, roles, userFollows, userRoles, users } from '../../../app/database/schema';
import { ROLES } from '../../../shared/constants';
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
}

export interface IAdminUserRepository {
  list(filter: AdminListFilter): Promise<{ data: AdminUserRow[]; rolesByUser: Map<number, string[]>; total: number }>;
  findDetail(userId: number): Promise<AdminUserDetailDto | null>;
  findUserRoles(userId: number): Promise<string[]>;
  setBan(userId: number, isBanned: boolean, banReason: string | null): Promise<void>;
  softDelete(userId: number): Promise<void>;
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

    // Admin views include soft-deleted users (F2 §05 invariant 6); no
    // deleted_at filter is applied here. Role filtering (when present)
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
    if (userIds.length > 0) {
      const roleRows = await db
        .select({ userId: userRoles.userId, roleName: roles.roleName })
        .from(userRoles)
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(inArray(userRoles.userId, userIds));

      for (const row of roleRows) {
        const current = rolesByUser.get(row.userId) ?? [];
        current.push(row.roleName);
        rolesByUser.set(row.userId, current);
      }
    }

    return {
      data: rows as AdminUserRow[],
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