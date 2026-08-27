import { and, count, eq, isNull } from 'drizzle-orm';
import { db, permissions, roles, users } from '../../../app/database';
import type { DashboardSummary } from '../types';

export interface IDashboardRepository {
  getSummary(): Promise<DashboardSummary>;
}

export class DashboardRepository implements IDashboardRepository {
  async getSummary(): Promise<DashboardSummary> {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalRoles,
      totalPermissions,
    ] = await Promise.all([
      db.select({ value: count() }).from(users),
      db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.isActive, true), eq(users.isBanned, false), isNull(users.deletedAt))),
      db.select({ value: count() }).from(users).where(eq(users.isBanned, true)),
      db.select({ value: count() }).from(roles),
      db.select({ value: count() }).from(permissions),
    ]);

    const total = totalUsers[0]?.value ?? 0;
    const active = activeUsers[0]?.value ?? 0;
    const suspended = suspendedUsers[0]?.value ?? 0;

    return {
      totalUsers: total,
      activeUsers: active,
      inactiveUsers: total - active - suspended,
      suspendedUsers: suspended,
      totalRoles: totalRoles[0]?.value ?? 0,
      totalPermissions: totalPermissions[0]?.value ?? 0,
    };
  }
}

export const dashboardRepository = new DashboardRepository();
