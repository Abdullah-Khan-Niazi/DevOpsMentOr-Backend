import { asc, count, eq, sql } from 'drizzle-orm';
import { db, roles, userRoles, users } from '../../../app/database';
import { UserStatus, getUserStatus } from '../../../shared/constants';
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
    const rows = await db
      .select({
        isActive: users.isActive,
        isBanned: users.isBanned,
        deletedAt: users.deletedAt,
      })
      .from(users);

    const counts: Record<UserStatus, number> = {
      [UserStatus.ACTIVE]: 0,
      [UserStatus.INACTIVE]: 0,
      [UserStatus.SUSPENDED]: 0,
    };

    for (const row of rows) {
      counts[getUserStatus(row)] += 1;
    }

    return [
      { status: UserStatus.ACTIVE, count: counts[UserStatus.ACTIVE] },
      { status: UserStatus.INACTIVE, count: counts[UserStatus.INACTIVE] },
      { status: UserStatus.SUSPENDED, count: counts[UserStatus.SUSPENDED] },
    ];
  }

  async countUsersByRole(): Promise<RoleDistributionReport[]> {
    const rows = await db
      .select({
        role: roles.roleName,
        userCount: sql<number>`cast(count(${userRoles.userId}) as int)`,
      })
      .from(roles)
      .leftJoin(userRoles, eq(roles.roleId, userRoles.roleId))
      .groupBy(roles.roleId, roles.roleName)
      .orderBy(asc(roles.roleName));

    return rows.map((row) => ({
      role: row.role,
      userCount: Number(row.userCount),
    }));
  }
}

export const reportRepository = new ReportRepository();
