import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../../app/database';
import { auditLogs, users } from '../../../app/database/schema';
import { getSkipTake } from '../../../shared/utils';
import type { AuditLogFilter, AuditLogListItem, PaginatedAdminData } from '../dto/admin.dto';

export interface IAdminAuditRepository {
  list(filter: AuditLogFilter): Promise<PaginatedAdminData<AuditLogListItem>>;
}

export class AdminAuditRepository implements IAdminAuditRepository {
  async list(filter: AuditLogFilter): Promise<PaginatedAdminData<AuditLogListItem>> {
    const conditions = [];

    if (filter.action) {
      conditions.push(eq(auditLogs.action, filter.action));
    }
    if (filter.from) {
      conditions.push(gte(auditLogs.createdAt, filter.from));
    }
    if (filter.to) {
      conditions.push(lte(auditLogs.createdAt, filter.to));
    }

    const totalRow = await db
      .select({ value: count(auditLogs.logId) })
      .from(auditLogs)
      .innerJoin(users, eq(users.userId, auditLogs.adminUserId))
      .where(and(...conditions));

    const { skip, take } = getSkipTake(filter.page, filter.pageSize);
    const rows = await db
      .select({
        logId: auditLogs.logId,
        adminUserId: auditLogs.adminUserId,
        adminFullName: users.fullName,
        adminEmail: users.email,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        changes: auditLogs.changes,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .innerJoin(users, eq(users.userId, auditLogs.adminUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(take)
      .offset(skip);

    const data = rows.map((row) => ({
      logId: row.logId,
      adminUserId: row.adminUserId,
      adminFullName: row.adminFullName,
      adminEmail: row.adminEmail,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      changes: row.changes,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
    }));

    const total = totalRow[0]?.value ?? 0;
    return {
      data,
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / filter.pageSize),
    };
  }
}

export const adminAuditRepository = new AdminAuditRepository();