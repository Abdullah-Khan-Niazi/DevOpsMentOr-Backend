import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  db,
  permissions,
  rolePermissions,
  roles,
} from '../../../app/database';
import { createId, getSkipTake } from '../../../shared/utils';
import type { ListRolesFilter, RoleWithPermissions } from '../types';

export interface IRoleRepository {
  findById(id: string): Promise<RoleWithPermissions | null>;
  findByName(name: string): Promise<RoleWithPermissions | null>;
  findMany(filter: ListRolesFilter): Promise<{ items: RoleWithPermissions[]; total: number }>;
  create(data: {
    name: string;
    description?: string;
    permissionIds?: string[];
  }): Promise<RoleWithPermissions>;
  update(
    id: string,
    data: {
      name?: string;
      description?: string;
      permissionIds?: string[];
    },
  ): Promise<RoleWithPermissions>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export class RoleRepository implements IRoleRepository {
  async findById(id: string): Promise<RoleWithPermissions | null> {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, id) });
    if (!role) {
      return null;
    }
    return this.attachPermissions(role);
  }

  async findByName(name: string): Promise<RoleWithPermissions | null> {
    const role = await db.query.roles.findFirst({ where: eq(roles.name, name) });
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
      conditions.push(or(ilike(roles.name, search), ilike(roles.description, search)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields: Record<string, AnyPgColumn> = {
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      name: roles.name,
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
    name: string;
    description?: string;
    permissionIds?: string[];
  }): Promise<RoleWithPermissions> {
    const id = createId();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(roles).values({
        id,
        name: data.name,
        description: data.description,
        createdAt: now,
        updatedAt: now,
      });

      if (data.permissionIds && data.permissionIds.length > 0) {
        await tx.insert(rolePermissions).values(
          data.permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        );
      }
    });

    const created = await this.findById(id);
    if (!created) {
      throw new Error('Failed to create role.');
    }
    return created;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      permissionIds?: string[];
    },
  ): Promise<RoleWithPermissions> {
    await db.transaction(async (tx) => {
      await tx
        .update(roles)
        .set({
          name: data.name,
          description: data.description,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id));

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

  async delete(id: string): Promise<void> {
    await db.delete(roles).where(eq(roles.id, id));
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
        id: permissions.id,
        name: permissions.name,
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, role.id));

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: permissionRows.map((permission) => ({ permission })),
    };
  }
}

export const roleRepository = new RoleRepository();
