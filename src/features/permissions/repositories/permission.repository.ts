import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, permissions } from '../../../app/database';
import { createId, getSkipTake } from '../../../shared/utils';
import type { ListPermissionsFilter, PermissionEntity } from '../types';

export interface IPermissionRepository {
  findById(id: string): Promise<PermissionEntity | null>;
  findByName(name: string): Promise<PermissionEntity | null>;
  findMany(filter: ListPermissionsFilter): Promise<{ items: PermissionEntity[]; total: number }>;
  create(data: {
    name: string;
    description?: string;
    resource: string;
    action: string;
  }): Promise<PermissionEntity>;
  update(
    id: string,
    data: {
      name?: string;
      description?: string;
      resource?: string;
      action?: string;
    },
  ): Promise<PermissionEntity>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export class PermissionRepository implements IPermissionRepository {
  async findById(id: string): Promise<PermissionEntity | null> {
    const permission = await db.query.permissions.findFirst({
      where: eq(permissions.id, id),
    });
    return permission ?? null;
  }

  async findByName(name: string): Promise<PermissionEntity | null> {
    const permission = await db.query.permissions.findFirst({
      where: eq(permissions.name, name),
    });
    return permission ?? null;
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
          ilike(permissions.name, search),
          ilike(permissions.description, search),
          ilike(permissions.resource, search),
        ),
      );
    }

    if (filter.resource) {
      conditions.push(eq(permissions.resource, filter.resource));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortableFields: Record<string, AnyPgColumn> = {
      createdAt: permissions.createdAt,
      updatedAt: permissions.updatedAt,
      name: permissions.name,
      resource: permissions.resource,
      action: permissions.action,
    };
    const sortColumn = sortableFields[filter.sortBy ?? ''] ?? permissions.createdAt;
    const orderBy = filter.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [items, totalResult] = await Promise.all([
      db.select().from(permissions).where(where).orderBy(orderBy).limit(take).offset(skip),
      db.select({ value: count() }).from(permissions).where(where),
    ]);

    return { items, total: totalResult[0]?.value ?? 0 };
  }

  async create(data: {
    name: string;
    description?: string;
    resource: string;
    action: string;
  }): Promise<PermissionEntity> {
    const id = createId();
    const now = new Date();
    const [created] = await db
      .insert(permissions)
      .values({
        id,
        name: data.name,
        description: data.description,
        resource: data.resource,
        action: data.action,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create permission.');
    }
    return created;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      resource?: string;
      action?: string;
    },
  ): Promise<PermissionEntity> {
    const [updated] = await db
      .update(permissions)
      .set({
        name: data.name,
        description: data.description,
        resource: data.resource,
        action: data.action,
        updatedAt: new Date(),
      })
      .where(eq(permissions.id, id))
      .returning();

    if (!updated) {
      throw new Error('Failed to update permission.');
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    await db.delete(permissions).where(eq(permissions.id, id));
  }

  async count(): Promise<number> {
    const result = await db.select({ value: count() }).from(permissions);
    return result[0]?.value ?? 0;
  }
}

export const permissionRepository = new PermissionRepository();
