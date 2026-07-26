import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, permissions, rolePermissions, roles, userRoles, users } from '../../../app/database';
import { UserStatus } from '../../../shared/constants';
import { createId, getSkipTake } from '../../../shared/utils';
import type { ListUsersFilter, UserWithRoles } from '../types';

export interface IUserRepository {
  findById(id: string): Promise<UserWithRoles | null>;
  findByEmail(email: string): Promise<UserWithRoles | null>;
  findMany(filter: ListUsersFilter): Promise<{ items: UserWithRoles[]; total: number }>;
  create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    status?: UserStatus;
    roleIds?: string[];
  }): Promise<UserWithRoles>;
  update(
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      status?: UserStatus;
      roleIds?: string[];
    },
  ): Promise<UserWithRoles>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  countByStatus(status: UserStatus): Promise<number>;
}

export class UserRepository implements IUserRepository {
  async findById(id: string): Promise<UserWithRoles | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      return null;
    }
    return this.attachRoles(user);
  }

  async findByEmail(email: string): Promise<UserWithRoles | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
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
          ilike(users.email, search),
          ilike(users.firstName, search),
          ilike(users.lastName, search),
        ),
      );
    }

    if (filter.status) {
      conditions.push(eq(users.status, filter.status));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields: Record<string, AnyPgColumn> = {
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
    };
    const sortColumn = sortableFields[filter.sortBy ?? ''] ?? users.createdAt;
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
    firstName: string;
    lastName: string;
    status?: UserStatus;
    roleIds?: string[];
  }): Promise<UserWithRoles> {
    const id = createId();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        status: data.status ?? UserStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      });

      if (data.roleIds && data.roleIds.length > 0) {
        await tx.insert(userRoles).values(
          data.roleIds.map((roleId) => ({
            userId: id,
            roleId,
          })),
        );
      }
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error('Failed to create user.');
    }
    return created;
  }

  async update(
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      status?: UserStatus;
      roleIds?: string[];
    },
  ): Promise<UserWithRoles> {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          firstName: data.firstName,
          lastName: data.lastName,
          status: data.status,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));

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

  async delete(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async count(): Promise<number> {
    const result = await db.select({ value: count() }).from(users);
    return result[0]?.value ?? 0;
  }

  async countByStatus(status: UserStatus): Promise<number> {
    const result = await db.select({ value: count() }).from(users).where(eq(users.status, status));
    return result[0]?.value ?? 0;
  }

  private async attachRoles(user: typeof users.$inferSelect): Promise<UserWithRoles> {
    const roleRows = await db
      .select({
        roleId: roles.id,
        roleName: roles.name,
        permissionId: permissions.id,
        permissionName: permissions.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, user.id));

    const roleMap = new Map<
      string,
      {
        role: {
          id: string;
          name: string;
          permissions: Array<{ permission: { id: string; name: string } }>;
        };
      }
    >();

    for (const row of roleRows) {
      let entry = roleMap.get(row.roleId);
      if (!entry) {
        entry = {
          role: {
            id: row.roleId,
            name: row.roleName,
            permissions: [],
          },
        };
        roleMap.set(row.roleId, entry);
      }

      if (row.permissionId && row.permissionName) {
        const alreadyExists = entry.role.permissions.some(
          (item) => item.permission.id === row.permissionId,
        );
        if (!alreadyExists) {
          entry.role.permissions.push({
            permission: {
              id: row.permissionId,
              name: row.permissionName,
            },
          });
        }
      }
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status as UserStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: Array.from(roleMap.values()),
    };
  }
}

export const userRepository = new UserRepository();
