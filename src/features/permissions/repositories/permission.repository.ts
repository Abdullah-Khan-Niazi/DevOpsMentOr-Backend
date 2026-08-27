import { and, asc, count, desc, eq, like, or } from 'drizzle-orm';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { db, permissions } from '../../../app/database';
import { getSkipTake } from '../../../shared/utils';
import type { ListPermissionsFilter, PermissionEntity } from '../types';

export interface IPermissionRepository {
  findById(id: number): Promise<PermissionEntity | null>;
  findByName(name: string): Promise<PermissionEntity | null>;
  findMany(filter: ListPermissionsFilter): Promise<{ items: PermissionEntity[]; total: number }>;
  create(data: { permissionName: string; description?: string; module?: string }): Promise<PermissionEntity>;
  update(
    id: number,
    data: { permissionName?: string; description?: string; module?: string },
  ): Promise<PermissionEntity>;
  delete(id: number): Promise<void>;
  count(): Promise<number>;
}

export class PermissionRepository implements IPermissionRepository {
  async findById(id: number): Promise<PermissionEntity | null> {
    const permission = await db.query.permissions.findFirst({
      where: eq(permissions.permissionId, id),
    });
    return permission ? this.toEntity(permission) : null;
  }

  async findByName(name: string): Promise<PermissionEntity | null> {
    const permission = await db.query.permissions.findFirst({
      where: eq(permissions.permissionName, name),
    });
    return permission ? this.toEntity(permission) : null;
  }

  async findMany(
    filter: ListPermissionsFilter,
  ): Promise<{ items: PermissionEntity[]; total: number }> {
    const { skip, take } = getSkipTake(filter.page, filter.limit);
    const conditions = [];

    if (filter.search) {
      const search = `%${filter.search}%`;
      conditions.push(
        or(
          like(permissions.permissionName, search),
          like(permissions.description, search),
          like(permissions.module, search),
        ),
      );
    }

    if (filter.module) {
      conditions.push(eq(permissions.module, filter.module));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields: Record<string, AnyMySqlColumn> = {
      createdAt: permissions.createdAt,
      permissionName: permissions.permissionName,
      module: permissions.module,
    };
    const sortColumn = sortableFields[filter.sortBy ?? ''] ?? permissions.createdAt;
    const orderBy = filter.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [items, totalResult] = await Promise.all([
      db.select().from(permissions).where(where).orderBy(orderBy).limit(take).offset(skip),
      db.select({ value: count() }).from(permissions).where(where),
    ]);

    return { items: items.map((permission) => this.toEntity(permission)), total: totalResult[0]?.value ?? 0 };
  }

  async create(data: {
    permissionName: string;
    description?: string;
    module?: string;
  }): Promise<PermissionEntity> {
    const [inserted] = await db
      .insert(permissions)
      .values({
        permissionName: data.permissionName,
        description: data.description,
        module: data.module,
      })
      .$returningId();

    const createdId = inserted?.permissionId;
    if (!createdId) {
      throw new Error('Failed to create permission.');
    }

    const created = await this.findById(createdId);
    if (!created) {
      throw new Error('Failed to create permission.');
    }
    return created;
  }

  async update(
    id: number,
    data: { permissionName?: string; description?: string; module?: string },
  ): Promise<PermissionEntity> {
    await db
      .update(permissions)
      .set({
        permissionName: data.permissionName,
        description: data.description,
        module: data.module,
      })
      .where(eq(permissions.permissionId, id));

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error('Failed to update permission.');
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    await db.delete(permissions).where(eq(permissions.permissionId, id));
  }

  async count(): Promise<number> {
    const result = await db.select({ value: count() }).from(permissions);
    return result[0]?.value ?? 0;
  }

  private toEntity(permission: typeof permissions.$inferSelect): PermissionEntity {
    return {
      id: permission.permissionId,
      permissionName: permission.permissionName,
      description: permission.description,
      module: permission.module,
      createdAt: permission.createdAt,
    };
  }
}

export const permissionRepository = new PermissionRepository();