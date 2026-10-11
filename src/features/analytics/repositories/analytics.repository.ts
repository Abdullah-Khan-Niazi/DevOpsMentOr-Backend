import { and, count, desc, eq, gte, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  activityLogs,
  certificates,
  countries,
  loginHistory,
  notifications,
  organizations,
  pointsHistory,
  pwnboxInstances,
  reports,
  reviews,
  subscriptions,
  userProfiles,
  userProgress,
  users,
} from '../../../app/database/schema';

/**
 * F8 §07 analytics aggregation (OPS-41/42).
 *
 * Read-only, anonymized aggregate queries only (invariant 11): no query
 * here selects a `user_id`, and every result is a cohort count or sum.
 */

export interface ActivityTrendRow {
  /** ISO day key (`YYYY-MM-DDT00:00:00.000Z`). */
  date: string;
  activeUsers: number;
  newSignups: number;
  courseCompletions: number;
  pointsAwarded: number;
}

import type {
  ActivityHeatmapDayDto,
  CountryDistributionDto,
  FunnelStageDto,
  MultiMetricHeatmapsDto,
  PwnboxAnalyticsDto,
  SubscriptionBreakdownDto,
} from '../dto/analytics.dto';

export interface IAnalyticsRepository {
  countActiveUsers7d(): Promise<number>;
  countNewSignups30d(): Promise<number>;
  countCourseCompletions30d(): Promise<number>;
  sumPointsAwarded7d(): Promise<number>;
  countActiveSubscriptions(): Promise<number>;
  countNotificationsSent7d(): Promise<number>;
  countPendingReports(): Promise<number>;
  countNewReviews7d(): Promise<number>;
  getActivityTrend(days: number): Promise<ActivityTrendRow[]>;
  getUserFunnel(): Promise<FunnelStageDto[]>;
  getCountryDistribution(): Promise<CountryDistributionDto[]>;
  getSubscriptionBreakdown(): Promise<SubscriptionBreakdownDto[]>;
  getActivityHeatmap(days?: number): Promise<ActivityHeatmapDayDto[]>;
  getMultiMetricHeatmaps(days?: number): Promise<MultiMetricHeatmapsDto>;
  getPwnboxStats(): Promise<PwnboxAnalyticsDto>;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export class AnalyticsRepository implements IAnalyticsRepository {
  async countActiveUsers7d(): Promise<number> {
    const rows = await db
      .select({ value: sql<number>`COUNT(DISTINCT ${activityLogs.userId})` })
      .from(activityLogs)
      .where(gte(activityLogs.createdAt, daysAgo(7)));
    return rows[0]?.value ?? 0;
  }

  async countNewSignups30d(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(users)
      .where(gte(users.createdAt, daysAgo(30)));
    return rows[0]?.value ?? 0;
  }

  async countCourseCompletions30d(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(certificates)
      .where(gte(certificates.issuedAt, daysAgo(30)));
    return rows[0]?.value ?? 0;
  }

  async sumPointsAwarded7d(): Promise<number> {
    const rows = await db
      .select({ value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)` })
      .from(pointsHistory)
      .where(and(gte(pointsHistory.createdAt, daysAgo(7)), gt(pointsHistory.pointsChange, 0)));
    return rows[0]?.value ?? 0;
  }

  async countActiveSubscriptions(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.isActive, true),
          or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async countNotificationsSent7d(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(gte(notifications.createdAt, daysAgo(7)));
    return rows[0]?.value ?? 0;
  }

  async countPendingReports(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.status, 'pending'));
    return rows[0]?.value ?? 0;
  }

  async countNewReviews7d(): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(reviews)
      .where(gte(reviews.createdAt, daysAgo(7)));
    return rows[0]?.value ?? 0;
  }

  async getActivityTrend(days: number): Promise<ActivityTrendRow[]> {
    const from = daysAgo(days);

    const [active, signups, completions, points] = await Promise.all([
      db
        .select({
          date: sql<Date>`DATE(${activityLogs.createdAt})`,
          value: sql<number>`COUNT(DISTINCT ${activityLogs.userId})`,
        })
        .from(activityLogs)
        .where(gte(activityLogs.createdAt, from))
        .groupBy(sql`DATE(${activityLogs.createdAt})`),
      db
        .select({
          date: sql<Date>`DATE(${users.createdAt})`,
          value: sql<number>`COUNT(*)`,
        })
        .from(users)
        .where(gte(users.createdAt, from))
        .groupBy(sql`DATE(${users.createdAt})`),
      db
        .select({
          date: sql<Date>`DATE(${certificates.issuedAt})`,
          value: sql<number>`COUNT(*)`,
        })
        .from(certificates)
        .where(gte(certificates.issuedAt, from))
        .groupBy(sql`DATE(${certificates.issuedAt})`),
      db
        .select({
          date: sql<Date>`DATE(${pointsHistory.createdAt})`,
          value: sql<number>`COALESCE(SUM(${pointsHistory.pointsChange}), 0)`,
        })
        .from(pointsHistory)
        .where(and(gte(pointsHistory.createdAt, from), gt(pointsHistory.pointsChange, 0)))
        .groupBy(sql`DATE(${pointsHistory.createdAt})`),
    ]);

    const buckets = new Map<string, ActivityTrendRow>();
    const add = (key: string, partial: Partial<ActivityTrendRow>): void => {
      const current = buckets.get(key) ?? {
        date: key,
        activeUsers: 0,
        newSignups: 0,
        courseCompletions: 0,
        pointsAwarded: 0,
      };
      buckets.set(key, { ...current, ...partial });
    };

    const dayKey = (value: Date | string): string => {
      if (typeof value === 'string') {
        return value.slice(0, 10);
      }
      return value.toISOString().slice(0, 10);
    };

    for (const row of active) add(dayKey(row.date), { activeUsers: row.value });
    for (const row of signups) add(dayKey(row.date), { newSignups: row.value });
    for (const row of completions) add(dayKey(row.date), { courseCompletions: row.value });
    for (const row of points) add(dayKey(row.date), { pointsAwarded: row.value });

    return [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, date: `${row.date}T00:00:00.000Z` }));
  }

  async getUserFunnel(): Promise<FunnelStageDto[]> {
    const [totalUsers, activeLearners, labUsers, certifiedUsers] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: sql<number>`COUNT(DISTINCT ${userProgress.userId})` }).from(userProgress),
      db.select({ value: sql<number>`COUNT(DISTINCT ${pwnboxInstances.userId})` }).from(pwnboxInstances),
      db.select({ value: sql<number>`COUNT(DISTINCT ${certificates.userId})` }).from(certificates),
    ]);

    const base = Math.max(totalUsers[0]?.value ?? 0, 1);
    const stages = [
      { stage: 'Registered Users', count: totalUsers[0]?.value ?? 0 },
      { stage: 'Curriculum Learners', count: activeLearners[0]?.value ?? 0 },
      { stage: 'Lab Practitioners', count: labUsers[0]?.value ?? 0 },
      { stage: 'Certified Graduates', count: certifiedUsers[0]?.value ?? 0 },
    ];

    return stages.map((s) => ({
      stage: s.stage,
      count: s.count,
      percentage: Math.min(100, Math.round((s.count / base) * 100)),
    }));
  }

  async getCountryDistribution(): Promise<CountryDistributionDto[]> {
    const rows = await db
      .select({
        countryCode: countries.countryCode,
        countryName: countries.countryName,
        userCount: count(userProfiles.userId),
      })
      .from(userProfiles)
      .innerJoin(countries, eq(countries.countryId, userProfiles.countryId))
      .groupBy(countries.countryId, countries.countryCode, countries.countryName)
      .orderBy(desc(count(userProfiles.userId)))
      .limit(8);

    return rows.map((r) => ({
      countryCode: r.countryCode,
      countryName: r.countryName,
      userCount: Number(r.userCount),
    }));
  }

  async getSubscriptionBreakdown(): Promise<SubscriptionBreakdownDto[]> {
    const rows = await db
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
      .groupBy(subscriptions.planType);

    return rows.map((r) => ({
      planType: r.planType ?? 'free',
      count: Number(r.count),
    }));
  }

  async getActivityHeatmap(days = 84): Promise<ActivityHeatmapDayDto[]> {
    const from = daysAgo(days);
    const rows = await db
      .select({
        date: sql<Date>`DATE(${activityLogs.createdAt})`,
        count: count(),
      })
      .from(activityLogs)
      .where(gte(activityLogs.createdAt, from))
      .groupBy(sql`DATE(${activityLogs.createdAt})`);

    const countMap = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10);
      countMap.set(key, Number(r.count));
    }

    const result: ActivityHeatmapDayDto[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const cnt = countMap.get(key) ?? 0;
      const level = cnt === 0 ? 0 : cnt <= 2 ? 1 : cnt <= 5 ? 2 : cnt <= 10 ? 3 : 4;
      result.push({ date: key, count: cnt, level });
    }

    return result;
  }

  async getMultiMetricHeatmaps(days = 84): Promise<MultiMetricHeatmapsDto> {
    const from = daysAgo(days);

    const [actRows, loginRows, labRows, signupRows, orgRows] = await Promise.all([
      db
        .select({
          date: sql<Date>`DATE(${activityLogs.createdAt})`,
          count: count(),
        })
        .from(activityLogs)
        .where(gte(activityLogs.createdAt, from))
        .groupBy(sql`DATE(${activityLogs.createdAt})`),
      db
        .select({
          date: sql<Date>`DATE(${loginHistory.createdAt})`,
          count: count(),
        })
        .from(loginHistory)
        .where(gte(loginHistory.createdAt, from))
        .groupBy(sql`DATE(${loginHistory.createdAt})`),
      db
        .select({
          date: sql<Date>`DATE(${pwnboxInstances.startedAt})`,
          count: count(),
        })
        .from(pwnboxInstances)
        .where(gte(pwnboxInstances.startedAt, from))
        .groupBy(sql`DATE(${pwnboxInstances.startedAt})`),
      db
        .select({
          date: sql<Date>`DATE(${users.createdAt})`,
          count: count(),
        })
        .from(users)
        .where(gte(users.createdAt, from))
        .groupBy(sql`DATE(${users.createdAt})`),
      db
        .select({
          date: sql<Date>`DATE(${organizations.createdAt})`,
          count: count(),
        })
        .from(organizations)
        .where(gte(organizations.createdAt, from))
        .groupBy(sql`DATE(${organizations.createdAt})`),
    ]);

    const build = (rows: { date: Date | string; count: number | string }[]): ActivityHeatmapDayDto[] => {
      const countMap = new Map<string, number>();
      for (const r of rows) {
        const key = String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10);
        countMap.set(key, Number(r.count));
      }

      const res: ActivityHeatmapDayDto[] = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        const cnt = countMap.get(key) ?? 0;
        const level = cnt === 0 ? 0 : cnt <= 2 ? 1 : cnt <= 5 ? 2 : cnt <= 10 ? 3 : 4;
        res.push({ date: key, count: cnt, level });
      }
      return res;
    };

    return {
      activity: build(actRows),
      logins: build(loginRows),
      labs: build(labRows),
      signups: build(signupRows),
      orgs: build(orgRows),
    };
  }

  async getPwnboxStats(): Promise<PwnboxAnalyticsDto> {
    const [stats, resources, duration, total] = await Promise.all([
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
      db.select({ value: count() }).from(pwnboxInstances),
    ]);

    const counts: Record<string, number> = { running: 0, pending: 0, error: 0, terminated: 0 };
    for (const r of stats) {
      if (r.status) counts[r.status] = Number(r.count);
    }

    return {
      totalInstances: total[0]?.value ?? 0,
      activeInstances: counts.running ?? 0,
      pendingInstances: counts.pending ?? 0,
      errorInstances: counts.error ?? 0,
      terminatedInstances: counts.terminated ?? 0,
      totalRamGb: Number(resources[0]?.totalRamGb ?? 0),
      totalCpuCores: Number(resources[0]?.totalCpuCores ?? 0),
      avgDurationMinutes: Math.round(Number(duration[0]?.avgDuration ?? 0)),
    };
  }
}

export const analyticsRepository = new AnalyticsRepository();