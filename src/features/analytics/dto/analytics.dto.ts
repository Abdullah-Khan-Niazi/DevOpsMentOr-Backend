/**
 * F8 response DTOs for the platform analytics dashboard (OPS-41/42).
 * Every value is an anonymized aggregate: no individual learner data is
 * exposed (invariant 11, 3D matrix).
 */

/** OPS-41: KPI payload. */
export interface AnalyticsOverviewDto {
  activeUsers7d: number;
  newSignups30d: number;
  courseCompletions30d: number;
  pointsAwarded7d: number;
  activeSubscriptions: number;
  notificationsSent7d: number;
  pendingReports: number;
  newReviews7d: number;
}

/** OPS-42: one daily aggregate point. */
export interface ActivityTrendPointDto {
  date: string;
  activeUsers: number;
  newSignups: number;
  courseCompletions: number;
  pointsAwarded: number;
}

/** OPS-42: trend payload. */
export interface ActivityTrendDto {
  days: number;
  data: ActivityTrendPointDto[];
}

export interface FunnelStageDto {
  stage: string;
  count: number;
  percentage: number;
}

export interface CountryDistributionDto {
  countryCode: string;
  countryName: string;
  userCount: number;
}

export interface SubscriptionBreakdownDto {
  planType: string;
  count: number;
}

export interface ActivityHeatmapDayDto {
  date: string;
  count: number;
  level: number;
}

export interface PwnboxAnalyticsDto {
  totalInstances: number;
  activeInstances: number;
  pendingInstances: number;
  errorInstances: number;
  terminatedInstances: number;
  totalRamGb: number;
  totalCpuCores: number;
  avgDurationMinutes: number;
}

export interface UserSessionAnalyticsDto {
  currentlyActiveUsers: number;
  activeSessions: number;
  avgStayDurationMinutes: number;
  minStayDurationMinutes: number;
  maxStayDurationMinutes: number;
}

export interface MultiMetricHeatmapsDto {
  activity: ActivityHeatmapDayDto[];
  logins: ActivityHeatmapDayDto[];
  labs: ActivityHeatmapDayDto[];
  signups: ActivityHeatmapDayDto[];
  orgs: ActivityHeatmapDayDto[];
}

export interface DetailedAnalyticsDto {
  overview: AnalyticsOverviewDto;
  funnel: FunnelStageDto[];
  countries: CountryDistributionDto[];
  subscriptionBreakdown: SubscriptionBreakdownDto[];
  heatmap: ActivityHeatmapDayDto[];
  heatmaps?: MultiMetricHeatmapsDto;
  pwnbox: PwnboxAnalyticsDto;
  sessionStats?: UserSessionAnalyticsDto;
}