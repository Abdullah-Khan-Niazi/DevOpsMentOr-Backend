import { asc, count, eq, sql } from 'drizzle-orm';
import { db, roles, userRoles, users } from '../../../app/database';
import type { RoleDistributionReport, UserStatusReport } from '../types';

export interface IReportRepository {
  countUsers(): Promise<number>;
  countUsersByStatus(): Promise<UserStatusReport[]>;
  countUsersByRole(): Promise<RoleDistributionReport[]>;
}

export class ReportRepository implements IReportRepository {
  async countUsers(): Promise<number> {
    const result = await db.select({ value: count() }).from(users);
    return result[0]?.value ?? 0;
  }

  async countUsersByStatus(): Promise<UserStatusReport[]> {
    const grouped = await db
      .select({
        status: users.status,
        count: count(),
      })
      .from(users)
      .groupBy(users.status);

    return grouped.map((item) => ({
      status: item.status,
      count: item.count,
    }));
  }

  async countUsersByRole(): Promise<RoleDistributionReport[]> {
    const rows = await db
      .select({
        role: roles.name,
        userCount: sql<number>`cast(count(${userRoles.userId}) as int)`,
      })
      .from(roles)
      .leftJoin(userRoles, eq(roles.id, userRoles.roleId))
      .groupBy(roles.id, roles.name)
      .orderBy(asc(roles.name));

    return rows.map((row) => ({
      role: row.role,
      userCount: Number(row.userCount),
    }));
  }
}

export const reportRepository = new ReportRepository();
