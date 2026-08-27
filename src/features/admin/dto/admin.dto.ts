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

/** ADM-06: KPI payload. `labsCompleted` is a forward hook from F6. */
export interface AdminDashboardKpis {
  totalIndividualLearners: number;
  totalOrganizations: number;
  activeLearners: number;
  labsCompleted: number | null;
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
}

export interface AuditLogFilter {
  page: number;
  pageSize: number;
  action?: string;
  from?: Date;
  to?: Date;
}

/** Identity of the platform admin performing a mutation (for audit rows). */
export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}