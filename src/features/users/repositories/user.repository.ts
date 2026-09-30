import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import { permissions, rolePermissions, roles, userRoles, users } from '../../../app/database/schema';
import { UserStatus } from '../../../shared/constants';
import { getSkipTake } from '../../../shared/utils';
import type { ListUsersFilter, UserWithRoles } from '../types';

export interface IUserRepository {
  findById(id: number): Promise<UserWithRoles | null>;
  findByEmail(email: string): Promise<UserWithRoles | null>;
  findByUsername(username: string): Promise<UserWithRoles | null>;
  findMany(filter: ListUsersFilter): Promise<{ items: UserWithRoles[]; total: number }>;
  create(data: {
    email: string;
    passwordHash: string;
    username: string;
    salt: string;
    fullName?: string;
    displayName?: string;
    status?: UserStatus;
    roleIds?: number[];
    isVerified?: boolean;
  }): Promise<UserWithRoles>;
  update(
    id: number,
    data: {
      fullName?: string;
      displayName?: string;
      status?: UserStatus;
      roleIds?: number[];
    },
  ): Promise<UserWithRoles>;
  delete(id: number): Promise<void>;
  count(): Promise<number>;
  countByStatus(status: UserStatus): Promise<number>;
}

export class UserRepository implements IUserRepository {
  async findById(id: number): Promise<UserWithRoles | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.userId, id),
    });
    if (!user) {
      return null;
    }
    return this.attachRoles(user);
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    const normalized = email.trim().toLowerCase();
    const user = await db.query.users.findFirst({
      where: eq(sql`LOWER(${users.email})`, normalized),
    });
    if (!user) {
      return null;
    }
    return this.attachRoles(user);
  }

  async findByUsername(username: string): Promise<UserWithRoles | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });
    if (!user) {
      return null;
    }
    return this.attachRoles(user);
  }

  async findMany(filter: ListUsersFilter): Promise<{ items: UserWithRoles[]; total: number }> {
    const { skip, take } = getSkipTake(filter.page, filter.limit);
    const conditions = [];

    if (filter.search) {
      const search = `%${filter.search}%`;
      conditions.push(
        or(
          like(users.email, search),
          like(users.username, search),
          like(users.fullName, search),
          like(users.displayName, search),
        ),
      );
    }

    if (filter.status) {
      conditions.push(eq(users.isActive, filter.status === UserStatus.ACTIVE));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields = {
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      email: users.email,
      username: users.username,
      fullName: users.fullName,
    };
    const sortKey = filter.sortBy as keyof typeof sortableFields | undefined;
    const sortColumn = (sortKey && sortableFields[sortKey]) ?? users.createdAt;
    const orderBy = filter.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [rows, totalResult] = await Promise.all([
      db.select().from(users).where(where).orderBy(orderBy).limit(take).offset(skip),
      db.select({ value: count() }).from(users).where(where),
    ]);

    const items = await Promise.all(rows.map((row) => this.attachRoles(row)));
    return { items, total: totalResult[0]?.value ?? 0 };
  }

  async create(data: {
    email: string;
    passwordHash: string;
    username: string;
    salt: string;
    fullName?: string;
    displayName?: string;
    status?: UserStatus;
    roleIds?: number[];
    isVerified?: boolean;
  }): Promise<UserWithRoles> {
    let userId: number | undefined;

    await db.transaction(async (tx) => {
      const inserted = await tx.insert(users).values({
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        username: data.username.trim(),
        salt: data.salt,
        fullName: data.fullName?.trim(),
        isVerified: data.isVerified ?? false,
        isActive: (data.status ?? UserStatus.ACTIVE) === UserStatus.ACTIVE,
        isBanned: false,
        deletedAt: null,
      });

      const createdUserId = inserted[0]?.insertId;
      if (!createdUserId) {
        throw new Error('Failed to create user.');
      }
      userId = createdUserId;

      if (data.roleIds && data.roleIds.length > 0) {
        await tx.insert(userRoles).values(
          data.roleIds.map((roleId) => ({
            userId: createdUserId,
            roleId,
          })),
        );
      }
    });

    if (!userId) {
      throw new Error('Failed to create user.');
    }

    const created = await this.findById(userId);
    if (!created) {
      throw new Error('Failed to create user.');
    }
    return created;
  }

  async update(
    id: number,
    data: {
      fullName?: string;
      displayName?: string;
      status?: UserStatus;
      roleIds?: number[];
    },
  ): Promise<UserWithRoles> {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          fullName: data.fullName,
          displayName: data.displayName,
          isActive: data.status === undefined ? undefined : data.status === UserStatus.ACTIVE,
          isBanned: data.status === UserStatus.SUSPENDED ? true : undefined,
        })
        .where(eq(users.userId, id));

      if (data.roleIds) {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        if (data.roleIds.length > 0) {
          await tx.insert(userRoles).values(
            data.roleIds.map((roleId) => ({
              userId: id,
              roleId,
            })),
          );
        }
      }
    });

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error('Failed to update user.');
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.delete(users).where(eq(users.userId, id));
  }

  async count(): Promise<number> {
    const result = await db.select({ value: count() }).from(users);
    return result[0]?.value ?? 0;
  }

  async countByStatus(status: UserStatus): Promise<number> {
    const result = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isActive, status === UserStatus.ACTIVE));
    return result[0]?.value ?? 0;
  }

  private async attachRoles(user: typeof users.$inferSelect): Promise<UserWithRoles> {
    const roleRows = await db
      .select({
        roleId: roles.roleId,
        roleName: roles.roleName,
        roleDescription: roles.description,
        rolePriority: roles.priority,
        roleCreatedAt: roles.createdAt,
        permissionId: permissions.permissionId,
        permissionName: permissions.permissionName,
        permissionDescription: permissions.description,
        permissionModule: permissions.module,
        permissionCreatedAt: permissions.createdAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.roleId))
      .leftJoin(rolePermissions, eq(roles.roleId, rolePermissions.roleId))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.permissionId))
      .where(eq(userRoles.userId, user.userId));

    const roleMap = new Map<
      number,
      {
        role: {
          id: number;
          roleName: string;
          description: string | null;
          priority: number;
          createdAt: Date;
          permissions: Array<{
            permission: {
              id: number;
              permissionName: string;
              description: string | null;
              module: string | null;
              createdAt: Date;
            };
          }>;
        };
      }
    >();

    for (const row of roleRows) {
      let entry = roleMap.get(row.roleId);
      if (!entry) {
        entry = {
          role: {
            id: row.roleId,
            roleName: row.roleName,
            description: row.roleDescription,
            priority: row.rolePriority,
            createdAt: row.roleCreatedAt,
            permissions: [],
          },
        };
        roleMap.set(row.roleId, entry);
      }

      if (row.permissionId && row.permissionName && row.permissionCreatedAt) {
        const alreadyExists = entry.role.permissions.some(
          (item) => item.permission.id === row.permissionId,
        );
        if (!alreadyExists) {
          entry.role.permissions.push({
            permission: {
              id: row.permissionId,
              permissionName: row.permissionName,
              description: row.permissionDescription,
              module: row.permissionModule,
              createdAt: row.permissionCreatedAt,
            },
          });
        }
      }
    }

    return {
      userId: user.userId,
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
      salt: user.salt,
      fullName: user.fullName,
      status: user.isBanned
        ? UserStatus.SUSPENDED
        : user.isActive
          ? UserStatus.ACTIVE
          : UserStatus.INACTIVE,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      coverPhotoUrl: user.coverPhotoUrl,
      isVerified: user.isVerified,
      isActive: user.isActive,
      isBanned: user.isBanned,
      banReason: user.banReason,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      registrationIp: user.registrationIp,
      timezone: user.timezone,
      language: user.language,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorSecret: user.twoFactorSecret,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      roles: Array.from(roleMap.values()),
    } as UserWithRoles;
  }
}

export const userRepository = new UserRepository();
