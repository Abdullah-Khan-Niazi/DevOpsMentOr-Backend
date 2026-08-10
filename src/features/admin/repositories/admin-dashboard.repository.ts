import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { auditLogs, organizations, roles, userRoles, users } from '../../../app/database/schema';
import { ROLES } from '../../../shared/constants';
import type { AuditLogListItem, AdminDashboardKpis } from '../dto/admin.dto';

export interface IAdminDashboardRepository {
  getKpis(): Promise<AdminDashboardKpis>;
  getRecentAuditLogs(limit: number): Promise<AuditLogListItem[]>;
}

export class AdminDashboardRepository implements IAdminDashboardRepository {
  async getKpis(): Promise<AdminDashboardKpis> {
    const [individualRow, activeRow, organizationsRow] = await Promise.all([
      db
        .select({ value: count(users.userId) })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER)),
      db
        .select({ value: count(users.userId) })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(
          and(
            eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
            eq(users.isActive, true),
            eq(users.isBanned, false),
          ),
        ),
      db.select({ value: count() }).from(organizations),
    ]);

    return {
      totalIndividualLearners: individualRow[0]?.value ?? 0,
      activeLearners: activeRow[0]?.value ?? 0,
      totalOrganizations: organizationsRow[0]?.value ?? 0,
      // F6 (lab execution) is not built yet; populated by that feature later.
      labsCompleted: null,
    };
  }

  async getRecentAuditLogs(limit: number): Promise<AuditLogListItem[]> {
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
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map((row) => ({
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
  }
}

export const adminDashboardRepository = new AdminDashboardRepository();