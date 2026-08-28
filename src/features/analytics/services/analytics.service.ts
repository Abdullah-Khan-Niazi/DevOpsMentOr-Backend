import type { AnalyticsOverviewDto, ActivityTrendDto } from '../dto/analytics.dto';
import type { IAnalyticsRepository } from '../repositories/analytics.repository';
import { analyticsRepository } from '../repositories/analytics.repository';

/**
 * F8 §07 analytics service (OPS-41/42). All queries are anonymized
 * aggregate reads over learner data; the endpoint stays behind
 * `platform.analytics.read`.
 */
export interface AnalyticsServiceDeps {
  repo: IAnalyticsRepository;
}

function defaultDeps(): AnalyticsServiceDeps {
  return { repo: analyticsRepository };
}

export class AnalyticsService {
  constructor(private readonly deps: AnalyticsServiceDeps = defaultDeps()) {}

  /** OPS-41: KPI overview. */
  async getOverview(): Promise<AnalyticsOverviewDto> {
    const [
      activeUsers7d,
      newSignups30d,
      courseCompletions30d,
      pointsAwarded7d,
      activeSubscriptions,
      notificationsSent7d,
      pendingReports,
      newReviews7d,
    ] = await Promise.all([
      this.deps.repo.countActiveUsers7d(),
      this.deps.repo.countNewSignups30d(),
      this.deps.repo.countCourseCompletions30d(),
      this.deps.repo.sumPointsAwarded7d(),
      this.deps.repo.countActiveSubscriptions(),
      this.deps.repo.countNotificationsSent7d(),
      this.deps.repo.countPendingReports(),
      this.deps.repo.countNewReviews7d(),
    ]);

    return {
      activeUsers7d,
      newSignups30d,
      courseCompletions30d,
      pointsAwarded7d,
      activeSubscriptions,
      notificationsSent7d,
      pendingReports,
      newReviews7d,
    };
  }

  /** OPS-42: daily activity trend over the requested window. */
  async getActivityTrend(days: number): Promise<ActivityTrendDto> {
    const rows = await this.deps.repo.getActivityTrend(days);
    return {
      days,
      data: rows.map((row) => ({
        date: row.date,
        activeUsers: row.activeUsers,
        newSignups: row.newSignups,
        courseCompletions: row.courseCompletions,
        pointsAwarded: row.pointsAwarded,
      })),
    };
  }
}

export const analyticsService = new AnalyticsService();