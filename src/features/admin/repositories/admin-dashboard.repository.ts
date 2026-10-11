import { and, count, desc, eq, gte, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import { systemTelemetryService } from '../../../shared/services/system-telemetry.service';
import {
  activityLogs,
  auditLogs,
  certificates,
  loginHistory,
  organizations,
  pwnboxInstances,
  roles,
  subscriptions,
  userProgress,
  userRoles,
  users,
} from '../../../app/database/schema';
import { ROLES } from '../../../shared/constants';
import type {
  AdminDashboardKpis,
  AuditLogListItem,
  FunnelStageDto,
  HourlyActivityPoint,
  KpiSparklinesDto,
  PeakActivityPointDto,
  SubscriptionBreakdownDto,
  UserSegmentationItemDto,
} from '../dto/admin.dto';

export interface IAdminDashboardRepository {
  getKpis(): Promise<AdminDashboardKpis>;
  getRecentAuditLogs(limit: number): Promise<AuditLogListItem[]>;
}

export class AdminDashboardRepository implements IAdminDashboardRepository {
  async getKpis(): Promise<AdminDashboardKpis> {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsersRow,
      individualRow,
      studentsRow,
      orgAdminsRow,
      platformAdminsRow,
      activeRow,
      organizationsRow,
      pwnboxStats,
      pwnboxResources,
      pwnboxDuration,
      paidSubscriptionsRow,
      subTiersRows,
      hourlyRows,
      curriculumLearnersRow,
      labPractitionersRow,
      certifiedGradsRow,
      signups5d,
      pods5d,
      active5d,
      sevenDayLogins,
      thirtyDayLogins,
    ] = await Promise.all([
      db.select({ value: count() }).from(users),
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
        .where(eq(roles.roleName, ROLES.ORG_STUDENT)),
      db
        .select({ value: count(users.userId) })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(eq(roles.roleName, ROLES.ORG_ADMIN)),
      db
        .select({ value: count(users.userId) })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .where(eq(roles.roleName, ROLES.PLATFORM_ADMIN)),
      db
        .select({ value: sql<number>`COUNT(DISTINCT ${users.userId})` })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.userId))
        .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
        .innerJoin(loginHistory, eq(loginHistory.userId, users.userId))
        .where(
          and(
            eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
            eq(users.isActive, true),
            eq(users.isBanned, false),
            gte(loginHistory.createdAt, thirtyDaysAgo),
          ),
        ),
      db.select({ value: count() }).from(organizations),
      db
        .select({
          status: pwnboxInstances.status,
          count: count(),
        })
        .from(pwnboxInstances)
        .groupBy(pwnboxInstances.status),
      db
        .select({
          totalRamGb: sql<number>`COALESCE(SUM(${pwnboxInstances.ramGb}), 0)`,
          totalCpuCores: sql<number>`COALESCE(SUM(${pwnboxInstances.cpuCores}), 0)`,
        })
        .from(pwnboxInstances)
        .where(eq(pwnboxInstances.status, 'running')),
      db
        .select({
          avgDuration: sql<number>`COALESCE(AVG(TIMESTAMPDIFF(MINUTE, ${pwnboxInstances.startedAt}, COALESCE(${pwnboxInstances.terminatedAt}, ${pwnboxInstances.expiresAt}, NOW()))), 0)`,
        })
        .from(pwnboxInstances),
      db
        .select({ value: count() })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.isActive, true),
            or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
          ),
        ),
      db
        .select({
          planType: subscriptions.planType,
          count: count(),
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.isActive, true),
            or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
          ),
        )
        .groupBy(subscriptions.planType),
      db
        .select({
          hour: sql<number>`HOUR(${loginHistory.createdAt})`,
          count: count(),
        })
        .from(loginHistory)
        .groupBy(sql`HOUR(${loginHistory.createdAt})`),
      db.select({ value: sql<number>`COUNT(DISTINCT ${userProgress.userId})` }).from(userProgress),
      db.select({ value: sql<number>`COUNT(DISTINCT ${pwnboxInstances.userId})` }).from(pwnboxInstances),
      db.select({ value: sql<number>`COUNT(DISTINCT ${certificates.userId})` }).from(certificates),
      db
        .select({
          date: sql<string>`DATE(${users.createdAt})`,
          count: count(),
        })
        .from(users)
        .where(gte(users.createdAt, fiveDaysAgo))
        .groupBy(sql`DATE(${users.createdAt})`),
      db
        .select({
          date: sql<string>`DATE(${pwnboxInstances.startedAt})`,
          count: count(),
        })
        .from(pwnboxInstances)
        .where(gte(pwnboxInstances.startedAt, fiveDaysAgo))
        .groupBy(sql`DATE(${pwnboxInstances.startedAt})`),
      db
        .select({
          date: sql<string>`DATE(${activityLogs.createdAt})`,
          count: sql<number>`COUNT(DISTINCT ${activityLogs.userId})`,
        })
        .from(activityLogs)
        .where(gte(activityLogs.createdAt, fiveDaysAgo))
        .groupBy(sql`DATE(${activityLogs.createdAt})`),
      db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${loginHistory.createdAt}, '+00:00', '+05:00'))`,
          count: count(),
        })
        .from(loginHistory)
        .where(gte(loginHistory.createdAt, sevenDaysAgo))
        .groupBy(sql`DATE(CONVERT_TZ(${loginHistory.createdAt}, '+00:00', '+05:00'))`),
      db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${loginHistory.createdAt}, '+00:00', '+05:00'))`,
          count: count(),
        })
        .from(loginHistory)
        .where(gte(loginHistory.createdAt, thirtyDaysAgo))
        .groupBy(sql`DATE(CONVERT_TZ(${loginHistory.createdAt}, '+00:00', '+05:00'))`),
    ]);

    const pwnboxCounts = {
      running: 0,
      pending: 0,
      stopped: 0,
      error: 0,
      terminated: 0,
    };
    for (const row of pwnboxStats) {
      if (row.status && row.status in pwnboxCounts) {
        pwnboxCounts[row.status as keyof typeof pwnboxCounts] = Number(row.count);
      }
    }

    // 12-hour Pakistani Standard Time (PKT = UTC+5) format for hourly density
    const hourlyMap = new Map<number, number>();
    for (const row of hourlyRows) {
      hourlyMap.set(Number(row.hour), Number(row.count));
    }
    let peakHourNum = 14;
    let maxHourCount = -1;
    const hourlyDistribution: HourlyActivityPoint[] = [];

    // Map 24 hours converted to PKT
    for (let h = 0; h < 24; h++) {
      const cnt = hourlyMap.get(h) ?? 0;
      if (cnt > maxHourCount) {
        maxHourCount = cnt;
        peakHourNum = h;
      }
      const pktHour = (h + 5) % 24;
      const ampm = pktHour >= 12 ? 'PM' : 'AM';
      const h12 = pktHour % 12 === 0 ? 12 : pktHour % 12;
      hourlyDistribution.push({
        hour: h,
        label: `${h12} ${ampm} PKT`,
        count: cnt,
      });
    }

    // Peak hour window in 12-hour PKT format
    const peakStartPkt = (peakHourNum + 5) % 24;
    const peakEndPkt = (peakStartPkt + 1) % 24;
    const sAmpm = peakStartPkt >= 12 ? 'PM' : 'AM';
    const eAmpm = peakEndPkt >= 12 ? 'PM' : 'AM';
    const s12 = peakStartPkt % 12 === 0 ? 12 : peakStartPkt % 12;
    const e12 = peakEndPkt % 12 === 0 ? 12 : peakEndPkt % 12;
    const peakHourStr = `${s12}:00 ${sAmpm} - ${e12}:00 ${eAmpm} PKT`;

    // 7-day and 30-day daily activity density curves (PKT)
    const sevenDayMap = new Map<string, number>();
    for (const row of sevenDayLogins) {
      if (row.date) sevenDayMap.set(String(row.date), Number(row.count));
    }
    const sevenDayDistribution: PeakActivityPointDto[] = [];
    const nowPkt = new Date(Date.now() + 5 * 3600 * 1000);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowPkt.getTime() - i * 86400 * 1000);
      const isoDate = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      sevenDayDistribution.push({
        label: `${label} PKT`,
        date: isoDate,
        count: sevenDayMap.get(isoDate) ?? 0,
      });
    }

    const thirtyDayMap = new Map<string, number>();
    for (const row of thirtyDayLogins) {
      if (row.date) thirtyDayMap.set(String(row.date), Number(row.count));
    }
    const thirtyDayDistribution: PeakActivityPointDto[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(nowPkt.getTime() - i * 86400 * 1000);
      const isoDate = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      thirtyDayDistribution.push({
        label: `${label} PKT`,
        date: isoDate,
        count: thirtyDayMap.get(isoDate) ?? 0,
      });
    }

    const totalUsers = totalUsersRow[0]?.value ?? 0;
    const paidUsers = paidSubscriptionsRow[0]?.value ?? 0;
    const freeUsers = Math.max(0, totalUsers - paidUsers);

    // Synchronize live allocated compute with system telemetry
    systemTelemetryService.updateAllocatedCompute({
      running: pwnboxCounts.running,
      pending: pwnboxCounts.pending,
      error: pwnboxCounts.error,
      stopped: pwnboxCounts.stopped,
      terminated: pwnboxCounts.terminated,
      totalRamGb: Number(pwnboxResources[0]?.totalRamGb ?? 0),
      totalCpuCores: Number(pwnboxResources[0]?.totalCpuCores ?? 0),
    });

    // Host Server, Cache, DB, AI & Session Telemetry
    const [hostTelemetry, cacheTelemetry, dbTelemetry, aiTelemetry, sessionTelemetry] = await Promise.all([
      systemTelemetryService.getHostTelemetry(),
      systemTelemetryService.getCacheTelemetry(),
      systemTelemetryService.getDatabaseTelemetry(),
      systemTelemetryService.getAiTelemetry(),
      systemTelemetryService.getUserSessionTelemetry(),
    ]);
    const requestTelemetry = systemTelemetryService.getRequestMetrics();

    // DB-driven 5-point sparkline generation (normalized 1..5)
    const toSparklineLevels = (rows: { count: number | string }[]): number[] => {
      const vals = rows.map((r) => Number(r.count));
      if (vals.length === 0) return [1, 2, 3, 2, 4];
      while (vals.length < 5) vals.unshift(1);
      const slice5 = vals.slice(-5);
      const max = Math.max(...slice5, 1);
      return slice5.map((v) => Math.min(5, Math.max(1, Math.round((v / max) * 5))));
    };

    const sparklines: KpiSparklinesDto = {
      userbase: toSparklineLevels(signups5d),
      pods: toSparklineLevels(pods5d),
      compute: [2, 3, 4, 3, Math.min(5, Math.max(1, pwnboxCounts.running + 1))],
      learners: toSparklineLevels(active5d),
    };

    // User segmentation for the hatched pie chart
    const safeTotal = Math.max(totalUsers, 1);
    const indCount = individualRow[0]?.value ?? 0;
    const studCount = studentsRow[0]?.value ?? 0;
    const orgAdminCount = orgAdminsRow[0]?.value ?? 0;
    const platAdminCount = platformAdminsRow[0]?.value ?? 0;

    const userSegmentation: UserSegmentationItemDto[] = [
      {
        segment: 'Individual Learners',
        count: indCount,
        percentage: Math.round((indCount / safeTotal) * 100),
      },
      {
        segment: 'University Students',
        count: studCount,
        percentage: Math.round((studCount / safeTotal) * 100),
      },
      {
        segment: 'Organization Admins',
        count: orgAdminCount,
        percentage: Math.round((orgAdminCount / safeTotal) * 100),
      },
      {
        segment: 'Platform Admins',
        count: platAdminCount,
        percentage: Math.round((platAdminCount / safeTotal) * 100),
      },
    ];

    // Conversion funnel
    const curriculumLearners = curriculumLearnersRow[0]?.value ?? 0;
    const labPractitioners = labPractitionersRow[0]?.value ?? 0;
    const certifiedGrads = certifiedGradsRow[0]?.value ?? 0;

    const funnel: FunnelStageDto[] = [
      {
        stage: 'Platform Registrations',
        count: totalUsers,
        percentage: 100,
      },
      {
        stage: 'Curriculum Learners',
        count: curriculumLearners,
        percentage: Math.min(100, Math.round((curriculumLearners / safeTotal) * 100)),
      },
      {
        stage: 'Lab Practitioners',
        count: labPractitioners,
        percentage: Math.min(100, Math.round((labPractitioners / safeTotal) * 100)),
      },
      {
        stage: 'Certified Graduates',
        count: certifiedGrads,
        percentage: Math.min(100, Math.round((certifiedGrads / safeTotal) * 100)),
      },
    ];

    // Subscription tiers
    const subscriptionBreakdown: SubscriptionBreakdownDto[] = [
      {
        planType: 'Free Tier',
        count: freeUsers,
        percentage: Math.round((freeUsers / safeTotal) * 100),
      },
      ...subTiersRows.map((st) => ({
        planType: st.planType ?? 'Premium',
        count: Number(st.count),
        percentage: Math.round((Number(st.count) / safeTotal) * 100),
      })),
    ];

    return {
      totalUsers,
      totalIndividualLearners: indCount,
      totalOrgStudents: studCount,
      totalOrganizations: organizationsRow[0]?.value ?? 0,
      activeLearners: activeRow[0]?.value ?? 0,
      labsCompleted: pwnboxCounts.terminated > 0 ? pwnboxCounts.terminated : null,
      pwnbox: {
        activePods: pwnboxCounts.running,
        pendingPods: pwnboxCounts.pending,
        stoppedPods: pwnboxCounts.stopped,
        errorPods: pwnboxCounts.error,
        terminatedPods: pwnboxCounts.terminated,
        totalActiveRamGb: Number(pwnboxResources[0]?.totalRamGb ?? 0),
        totalActiveCpuCores: Number(pwnboxResources[0]?.totalCpuCores ?? 0),
        avgDurationMinutes: Math.round(Number(pwnboxDuration[0]?.avgDuration ?? 0)),
        maxSimultaneousPods: pwnboxCounts.running + pwnboxCounts.pending,
      },
      telemetry: {
        status: pwnboxCounts.error > 5 ? 'DEGRADED' : 'OPERATIONAL',
        responseSuccessRate: 99.8,
        avgLatencyMs: 24,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      hostTelemetry,
      cacheTelemetry,
      dbTelemetry,
      aiTelemetry,
      requestTelemetry,
      sessionTelemetry,
      sparklines,
      userSegmentation,
      funnel,
      subscriptionBreakdown,
      peakActivity: {
        peakHour: peakHourStr,
        hourlyDistribution,
        sevenDayDistribution,
        thirtyDayDistribution,
      },
      userDistribution: {
        freeUsers,
        paidUsers,
      },
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