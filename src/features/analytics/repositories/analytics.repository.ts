import { and, count, eq, gte, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  activityLogs,
  certificates,
  notifications,
  pointsHistory,
  reports,
  reviews,
  subscriptions,
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
}

export const analyticsRepository = new AnalyticsRepository();