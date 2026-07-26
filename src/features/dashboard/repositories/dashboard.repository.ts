import { count, eq } from 'drizzle-orm';
import { db, permissions, roles, users } from '../../../app/database';
import { UserStatus } from '../../../shared/constants';
import type { DashboardSummary } from '../types';

export interface IDashboardRepository {
  getSummary(): Promise<DashboardSummary>;
}

export class DashboardRepository implements IDashboardRepository {
  async getSummary(): Promise<DashboardSummary> {
    const [totalUsers, activeUsers, inactiveUsers, suspendedUsers, totalRoles, totalPermissions] =
      await Promise.all([
        db.select({ value: count() }).from(users),
        db.select({ value: count() }).from(users).where(eq(users.status, UserStatus.ACTIVE)),
        db.select({ value: count() }).from(users).where(eq(users.status, UserStatus.INACTIVE)),
        db.select({ value: count() }).from(users).where(eq(users.status, UserStatus.SUSPENDED)),
        db.select({ value: count() }).from(roles),
        db.select({ value: count() }).from(permissions),
      ]);

    return {
      totalUsers: totalUsers[0]?.value ?? 0,
      activeUsers: activeUsers[0]?.value ?? 0,
      inactiveUsers: inactiveUsers[0]?.value ?? 0,
      suspendedUsers: suspendedUsers[0]?.value ?? 0,
      totalRoles: totalRoles[0]?.value ?? 0,
      totalPermissions: totalPermissions[0]?.value ?? 0,
    };
  }
}

export const dashboardRepository = new DashboardRepository();
