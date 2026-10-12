export interface AdminUserListItem {
  userId: number;
  email: string;
  username: string;
  fullName: string | null;
  isActive: boolean;
  isBanned: boolean;
  isVerified: boolean;
  roles: string[];
  createdAt: string;
  deletedAt: string | null;
  organizationId?: number | null;
  organizationName?: string | null;
  country?: string | null;
}

export interface PaginatedAdminData<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminLoginHistoryItem {
  loginId: number;
  loginType: 'email' | 'google' | 'github';
  isSuccessful: boolean;
  failureReason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminSkillsItem {
  skillId: number;
  skillName: string;
  category: string;
  proficiencyLevel: string;
  yearsExperience: number;
  isVerified: boolean;
}

export interface AdminUserDetailDto {
  userId: number;
  email: string;
  username: string;
  fullName: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  isBanned: boolean;
  isVerified: boolean;
  banReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  roles: string[];
  profile: {
    occupation: string | null;
    company: string | null;
    website: string | null;
    githubUrl: string | null;
    linkedinUrl: string | null;
    twitterHandle: string | null;
    discordUsername: string | null;
    reputationScore: number;
    profileViews: number;
    isPublic: boolean;
    country: { countryId: number; countryName: string } | null;
  } | null;
  skills: AdminSkillsItem[];
  loginHistory: AdminLoginHistoryItem[];
  followersCount: number;
  followingCount: number;
}

export interface AuditLogListItem {
  logId: number;
  adminUserId: number;
  adminFullName: string | null;
  adminEmail: string;
  action: string;
  targetType: string | null;
  targetId: number | null;
  changes: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface SystemSettingDto {
  settingId: number;
  settingKey: string;
  settingValue: unknown;
  groupName: string | null;
  description: string | null;
  isEditable: boolean;
  updatedAt: string | null;
}

export interface PlatformAdminDto {
  userId: number;
  email: string;
  username: string;
  fullName: string | null;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
}

export interface HourlyActivityPoint {
  hour: number;
  label: string;
  count: number;
}

export interface PeakActivityPointDto {
  label: string;
  count: number;
  date?: string;
}

export interface PwnboxTelemetryDto {
  activePods: number;
  pendingPods: number;
  stoppedPods: number;
  errorPods: number;
  terminatedPods: number;
  totalActiveRamGb: number;
  totalActiveCpuCores: number;
  avgDurationMinutes: number;
  maxSimultaneousPods: number;
}

export interface SystemTelemetryDto {
  status: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
  responseSuccessRate: number;
  avgLatencyMs: number;
  uptimeSeconds: number;
}

export interface TelemetryHistoryPointDto {
  time: string;
  cpuLoadPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  requestsPerMinute: number;
}

export interface HostTelemetryDto {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  activeCpuLoadPercent: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  avgCpuLoad: number;
  minCpuLoad: number;
  maxCpuLoad: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  freeMemoryMb: number;
  memoryUsagePercent: number;
  avgMemoryUsagePercent: number;
  minMemoryMb: number;
  maxMemoryMb: number;
  heapUsedMb: number;
  uptimeSeconds: number;
  history: TelemetryHistoryPointDto[];
  allocatedCompute?: AllocatedComputeDto;
  sevenDayHistory?: HourlyTelemetryPointDto[];
}

export interface AllocatedComputeDto {
  activeContainers: number;
  allocatedRamGb: number;
  allocatedCpuCores: number;
  pendingPods: number;
  errorPods: number;
  stoppedPods: number;
  terminatedPods: number;
  maxPodCapacity: number;
  kubernetesStatus: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
}

export interface HourlyTelemetryPointDto {
  timestamp: number;
  time: string;
  label: string;
  date: string;
  hour: number;
  cpuLoadPercent: number;
  cpuMin: number;
  cpuMax: number;
  cpuAvg: number;
  memoryPercent: number;
  memoryMin: number;
  memoryMax: number;
  memoryAvg: number;
  memoryUsedMb: number;
  requestsPerMinute: number;
  requestsTotal: number;
  requestsMin: number;
  requestsMax: number;
  allocatedContainers: number;
  allocatedRamGb: number;
  allocatedCpuCores: number;
  pendingPods: number;
  kubernetesStatus: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
}

export interface CacheTelemetryDto {
  status: 'CONNECTED' | 'DISCONNECTED';
  hits: number;
  misses: number;
  hitRatioPercent: number;
  usedMemoryBytes: number;
  usedMemoryHuman: string;
  maxMemoryHuman: string;
  maxMemoryBytes: number;
  memoryUsagePercent: number;
  peakMemoryHuman: string;
  totalCommands: number;
}

export interface DatabaseTelemetryDto {
  status: 'CONNECTED' | 'ERROR';
  totalQueries: number;
  activeConnections: number;
  threadsRunning: number;
  uptimeSeconds: number;
  totalStorageBytes: number;
  storageSizeHuman: string;
  dataSizeHuman: string;
  indexSizeHuman: string;
  bufferPoolBytesData: number;
  bufferPoolSizeHuman: string;
}

export interface AiTelemetryDto {
  activeConversations: number;
  totalMessagesSent: number;
  totalTokensConsumed: number;
  avgResponseLatencyMs: number;
}

export interface RequestTelemetryDto {
  totalRequests: number;
  hourlyRequests: number;
  dailyRequests: number;
  weeklyRequests: number;
  avgRequestsPerMinute: number;
}

export interface UserSessionTelemetryDto {
  currentlyActiveUsers: number;
  activeSessions: number;
  avgStayDurationMinutes: number;
  minStayDurationMinutes: number;
  maxStayDurationMinutes: number;
}

export interface KpiSparklinesDto {
  userbase: number[];
  pods: number[];
  compute: number[];
  learners: number[];
}

export interface UserSegmentationItemDto {
  segment: string;
  count: number;
  percentage: number;
}

export interface FunnelStageDto {
  stage: string;
  count: number;
  percentage: number;
}

export interface SubscriptionBreakdownDto {
  planType: string;
  count: number;
  percentage: number;
}

/** ADM-06: KPI payload backed by live database metrics and pwnbox instances. */
export interface AdminDashboardKpis {
  totalUsers: number;
  totalIndividualLearners: number;
  totalOrgStudents: number;
  totalOrganizations: number;
  activeLearners: number;
  labsCompleted: number | null;
  pwnbox: PwnboxTelemetryDto;
  telemetry: SystemTelemetryDto;
  hostTelemetry: HostTelemetryDto;
  cacheTelemetry?: CacheTelemetryDto;
  dbTelemetry?: DatabaseTelemetryDto;
  aiTelemetry?: AiTelemetryDto;
  requestTelemetry?: RequestTelemetryDto;
  sessionTelemetry?: UserSessionTelemetryDto;
  sparklines: KpiSparklinesDto;
  userSegmentation: UserSegmentationItemDto[];
  funnel: FunnelStageDto[];
  subscriptionBreakdown: SubscriptionBreakdownDto[];
  peakActivity: {
    peakHour: string;
    hourlyDistribution: HourlyActivityPoint[];
    sevenDayDistribution?: PeakActivityPointDto[];
    thirtyDayDistribution?: PeakActivityPointDto[];
  };
  userDistribution: {
    freeUsers: number;
    paidUsers: number;
  };
}

export interface AdminDashboardDto {
  kpis: AdminDashboardKpis;
  recentAuditLogs: AuditLogListItem[];
}

export interface AdminListFilter {
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  isBanned?: boolean;
  isActive?: boolean;
  isDeleted?: boolean;
  organizationId?: number;
  country?: string;
}

export interface AuditLogFilter {
  page: number;
  pageSize: number;
  action?: string;
  targetType?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

/** Identity of the platform admin performing a mutation (for audit rows). */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}