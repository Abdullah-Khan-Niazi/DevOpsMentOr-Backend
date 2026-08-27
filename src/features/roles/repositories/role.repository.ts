import { and, asc, count, desc, eq, like, or } from 'drizzle-orm';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import {
  db,
  permissions,
  rolePermissions,
  roles,
} from '../../../app/database';
import { getSkipTake } from '../../../shared/utils';
import type { ListRolesFilter, RoleWithPermissions } from '../types';

export interface IRoleRepository {
  findById(id: number): Promise<RoleWithPermissions | null>;
  findByName(name: string): Promise<RoleWithPermissions | null>;
  findMany(filter: ListRolesFilter): Promise<{ items: RoleWithPermissions[]; total: number }>;
  create(data: {
    roleName: string;
    description?: string;
    priority?: number;
    permissionIds?: number[];
  }): Promise<RoleWithPermissions>;
  update(
    id: number,
    data: {
      roleName?: string;
      description?: string;
      priority?: number;
      permissionIds?: number[];
    },
  ): Promise<RoleWithPermissions>;
  delete(id: number): Promise<void>;
  count(): Promise<number>;
}

export class RoleRepository implements IRoleRepository {
  async findById(id: number): Promise<RoleWithPermissions | null> {
    const role = await db.query.roles.findFirst({ where: eq(roles.roleId, id) });
    if (!role) {
      return null;
    }
    return this.attachPermissions(role);
  }

  async findByName(name: string): Promise<RoleWithPermissions | null> {
    const role = await db.query.roles.findFirst({ where: eq(roles.roleName, name) });
    if (!role) {
      return null;
    }
    return this.attachPermissions(role);
  }

  async findMany(filter: ListRolesFilter): Promise<{ items: RoleWithPermissions[]; total: number }> {
    const { skip, take } = getSkipTake(filter.page, filter.limit);
    const conditions = [];

    if (filter.search) {
      const search = `%${filter.search}%`;
      conditions.push(or(like(roles.roleName, search), like(roles.description, search)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields: Record<string, AnyMySqlColumn> = {
      createdAt: roles.createdAt,
      roleName: roles.roleName,
      priority: roles.priority,
    };
    const sortColumn = sortableFields[filter.sortBy ?? ''] ?? roles.createdAt;
    const orderBy = filter.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [rows, totalResult] = await Promise.all([
      db.select().from(roles).where(where).orderBy(orderBy).limit(take).offset(skip),
      db.select({ value: count() }).from(roles).where(where),
    ]);

    const items = await Promise.all(rows.map((row) => this.attachPermissions(row)));
    return { items, total: totalResult[0]?.value ?? 0 };
  }

  async create(data: {
    roleName: string;
    description?: string;
    priority?: number;
    permissionIds?: number[];
  }): Promise<RoleWithPermissions> {
    let roleId: number | undefined;

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(roles)
        .values({
          roleName: data.roleName,
          description: data.description,
          priority: data.priority,
        })
        .$returningId();

      const newRoleId = inserted[0]?.roleId;
      if (!newRoleId) {
        throw new Error('Failed to create role.');
      }
      roleId = newRoleId;

      if (data.permissionIds && data.permissionIds.length > 0) {
        await tx.insert(rolePermissions).values(
          data.permissionIds.map((permissionId) => ({
            roleId: newRoleId,
            permissionId,
          })),
        );
      }
    });

    const createdRoleId = roleId;
    if (!createdRoleId) {
      throw new Error('Failed to create role.');
    }

    const created = await this.findById(createdRoleId);
    if (!created) {
      throw new Error('Failed to create role.');
    }
    return created;
  }

  async update(
    id: number,
    data: {
      roleName?: string;
      description?: string;
      priority?: number;
      permissionIds?: number[];
    },
  ): Promise<RoleWithPermissions> {
    await db.transaction(async (tx) => {
      await tx
        .update(roles)
        .set({
          roleName: data.roleName,
          description: data.description,
          priority: data.priority,
        })
        .where(eq(roles.roleId, id));

      if (data.permissionIds) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (data.permissionIds.length > 0) {
          await tx.insert(rolePermissions).values(
            data.permissionIds.map((permissionId) => ({
              roleId: id,
              permissionId,
            })),
          );
        }
      }
    });

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error('Failed to update role.');
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.delete(roles).where(eq(roles.roleId, id));
  }

  async count(): Promise<number> {
    const result = await db.select({ value: count() }).from(roles);
    return result[0]?.value ?? 0;
  }

  private async attachPermissions(
    role: typeof roles.$inferSelect,
  ): Promise<RoleWithPermissions> {
    const permissionRows = await db
      .select({
        id: permissions.permissionId,
        permissionName: permissions.permissionName,
        description: permissions.description,
        module: permissions.module,
        createdAt: permissions.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.permissionId))
      .where(eq(rolePermissions.roleId, role.roleId));

    return {
      id: role.roleId,
      roleName: role.roleName,
      description: role.description,
      priority: role.priority,
      createdAt: role.createdAt,
      permissions: permissionRows.map((permission) => ({ permission })),
    };
  }
}

export const roleRepository = new RoleRepository();
