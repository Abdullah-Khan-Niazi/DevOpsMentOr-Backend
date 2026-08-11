import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Drizzle schema mapping for the `devops-mentor` MySQL database.
 *
 * SOURCE OF TRUTH: the `devops_db.sql` file at the repository root.
 * Every table below mirrors a CREATE TABLE statement present in that file.
 * No speculative, virtual, or purged tables are defined here.
 *
 * Scope: F1 (Identity, Authentication, Authorization & Access).
 * All other feature domains (orgs, curriculum, labs, billing, ...) map to
 * their own feature tables and are out of scope for this module.
 */

/**
 * `users` — Core identity store.
 * Mirrors `CREATE TABLE users` in devops_db.sql. Holds credentials
 * (password_hash + per-user salt), account state flags (is_verified,
 * is_active, is_banned), transport data (timezone/language), 2FA material
 * (two_factor_enabled / two_factor_secret), and audit timestamps.
 * Soft delete via `deleted_at` exists in the SQL source and is honored here.
 */
export const users = mysqlTable(
  'users',
  {
    userId: int('user_id').autoincrement().primaryKey(),
    username: varchar('username', { length: 50 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    salt: varchar('salt', { length: 64 }).notNull(),
    fullName: varchar('full_name', { length: 100 }),
    displayName: varchar('display_name', { length: 50 }),
    bio: text('bio'),
    avatarUrl: varchar('avatar_url', { length: 255 }),
    coverPhotoUrl: varchar('cover_photo_url', { length: 255 }),
    isVerified: boolean('is_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isBanned: boolean('is_banned').notNull().default(false),
    banReason: text('ban_reason'),
    lastLoginAt: timestamp('last_login_at'),
    lastLoginIp: varchar('last_login_ip', { length: 45 }),
    registrationIp: varchar('registration_ip', { length: 45 }),
    timezone: varchar('timezone', { length: 50 }).notNull().default('UTC'),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    uniqueIndex('users_username_key').on(table.username),
    uniqueIndex('users_email_key').on(table.email),
    index('idx_email').on(table.email),
    index('idx_username').on(table.username),
    index('idx_active').on(table.isActive),
  ],
);

/**
 * `roles` — Role definitions (platform_admin, org_admin, professor,
 * org_student, individual_learner, guest). `priority` orders role resolution.
 */
export const roles = mysqlTable(
  'roles',
  {
    roleId: int('role_id').autoincrement().primaryKey(),
    roleName: varchar('role_name', { length: 50 }).notNull(),
    description: text('description'),
    priority: int('priority').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('roles_role_name_key').on(table.roleName)],
);

/**
 * `permissions` — Permission definitions (e.g. `platform.admin.access`,
 * `auth:session:read`). `module` buckets permissions by feature domain.
 */
export const permissions = mysqlTable(
  'permissions',
  {
    permissionId: int('permission_id').autoincrement().primaryKey(),
    permissionName: varchar('permission_name', { length: 100 }).notNull(),
    description: text('description'),
    module: varchar('module', { length: 50 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('permissions_permission_name_key').on(table.permissionName)],
);

/**
 * `role_permissions` — Composite join: which permissions a role carries.
 * Composite PK (role_id, permission_id); cascade deletes from both parents.
 */
export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: int('role_id')
      .notNull()
      .references(() => roles.roleId, { onDelete: 'cascade' }),
    permissionId: int('permission_id')
      .notNull()
      .references(() => permissions.permissionId, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at').notNull().defaultNow(),
    grantedBy: int('granted_by'),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

/**
 * `user_roles` — Composite join: which roles a user holds.
 * Composite PK (user_id, role_id); cascade deletes from both parents.
 */
export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    roleId: int('role_id')
      .notNull()
      .references(() => roles.roleId, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
    assignedBy: int('assigned_by'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

/**
 * `sessions` — Active session + refresh token rotation store.
 * session_token (JTI) and refresh_token are unique; tokens rotate on every
 * refresh. A deactivated session (is_active = false) or expired row
 * (expires_at <= NOW()) rejects refresh attempts.
 */
export const sessions = mysqlTable(
  'sessions',
  {
    sessionId: int('session_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    sessionToken: varchar('session_token', { length: 255 }).notNull(),
    refreshToken: varchar('refresh_token', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    deviceType: varchar('device_type', { length: 50 }),
    browser: varchar('browser', { length: 50 }),
    os: varchar('os', { length: 50 }),
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_session_token_key').on(table.sessionToken),
    uniqueIndex('sessions_refresh_token_key').on(table.refreshToken),
    index('idx_token').on(table.sessionToken),
    index('idx_refresh').on(table.refreshToken),
  ],
);

/**
 * `otp_codes` — One-time passwords: email verification, password reset,
 * 2FA. One-time use enforced by `is_used`; `expires_at` enforced at read
 * time. `code` column is also the storage slot for admin invitation tokens.
 */
export const otpCodes = mysqlTable(
  'otp_codes',
  {
    otpId: int('otp_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    code: varchar('code', { length: 10 }).notNull(),
    type: mysqlEnum('type', [
      'email_verification',
      'password_reset',
      'two_factor',
      'phone_verification',
    ]).notNull(),
    isUsed: boolean('is_used').notNull().default(false),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_code').on(table.code), index('idx_expires').on(table.expiresAt)],
);

/**
 * `login_history` — Per-attempt audit trail (success + failure) for every
 * authentication method. `login_type` mirrors the SQL enum: email, google,
 * github (no other OAuth providers are supported).
 */
export const loginHistory = mysqlTable(
  'login_history',
  {
    loginId: int('login_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    loginType: mysqlEnum('login_type', ['email', 'google', 'github'])
      .notNull()
      .default('email'),
    isSuccessful: boolean('is_successful').notNull().default(true),
    failureReason: text('failure_reason'),
    locationCity: varchar('location_city', { length: 100 }),
    locationCountry: varchar('location_country', { length: 100 }),
    deviceId: varchar('device_id', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_user_login').on(table.userId), index('idx_created').on(table.createdAt)],
);

/**
 * `api_tokens` — Personal API access tokens. The raw token is shown exactly
 * once at creation; the persisted `api_token` value is a hash. `permissions`
 * is a JSON array of granted permission names.
 */
export const apiTokens = mysqlTable(
  'api_tokens',
  {
    tokenId: int('token_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    tokenName: varchar('token_name', { length: 100 }).notNull(),
    apiToken: varchar('api_token', { length: 255 }).notNull(),
    permissions: json('permissions'),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('api_tokens_api_token_key').on(table.apiToken)],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  roles: many(userRoles),
  sessions: many(sessions),
  otpCodes: many(otpCodes),
  loginHistory: many(loginHistory),
  apiTokens: many(apiTokens),
  profile: one(userProfiles),
  skills: many(userSkills),
  following: many(userFollows, { relationName: 'user_following' }),
  followers: many(userFollows, { relationName: 'user_followers' }),
  userSettings: many(userSettings),
  files: many(files),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(userRoles),
  permissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.userId] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.roleId] }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.roleId] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.permissionId],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.userId] }),
}));

export const otpCodesRelations = relations(otpCodes, ({ one }) => ({
  user: one(users, { fields: [otpCodes.userId], references: [users.userId] }),
}));

export const loginHistoryRelations = relations(loginHistory, ({ one }) => ({
  user: one(users, { fields: [loginHistory.userId], references: [users.userId] }),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.userId] }),
}));

// ═══════════════════════════════════════════════════════════════════════════
// F2 — Users, Profiles & Platform Administration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `countries` — Country catalog for the profile country selector (USR-14).
 * Mirrors `CREATE TABLE countries` in devops_db.sql. Seeded via scripts/seed.ts.
 */
export const countries = mysqlTable(
  'countries',
  {
    countryId: int('country_id').autoincrement().primaryKey(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    countryName: varchar('country_name', { length: 100 }).notNull(),
    iso3Code: char('iso3_code', { length: 3 }),
    numericCode: int('numeric_code'),
    phoneCode: varchar('phone_code', { length: 10 }),
    flagEmoji: varchar('flag_emoji', { length: 10 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('countries_country_code_key').on(table.countryCode)],
);

/**
 * `user_profiles` — Extended profile data (USR-02). Created lazily on first
 * profile-edit call (UPSERT keyed on `user_id`). `is_public` drives public
 * profile visibility (USR-10). Social/rank columns mirror the SQL source.
 */
export const userProfiles = mysqlTable(
  'user_profiles',
  {
    profileId: int('profile_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    countryId: int('country_id').references(() => countries.countryId),
    city: varchar('city', { length: 100 }),
    address: text('address'),
    phone: varchar('phone', { length: 20 }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    gender: mysqlEnum('gender', ['male', 'female', 'other', 'prefer_not_to_say']),
    occupation: varchar('occupation', { length: 100 }),
    company: varchar('company', { length: 100 }),
    website: varchar('website', { length: 255 }),
    githubUrl: varchar('github_url', { length: 255 }),
    linkedinUrl: varchar('linkedin_url', { length: 255 }),
    twitterHandle: varchar('twitter_handle', { length: 50 }),
    discordUsername: varchar('discord_username', { length: 100 }),
    hackerRankPoints: int('hacker_rank_points').notNull().default(0),
    globalRank: int('global_rank'),
    countryRank: int('country_rank'),
    reputationScore: int('reputation_score').notNull().default(0),
    profileViews: int('profile_views').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(true),
  },
  (table) => [uniqueIndex('user_profiles_user_id_key').on(table.userId)],
);

/**
 * `skills` — Skill catalog (USR-13). DevOps skills are seeded under the
 * `cloud` / `governance` categories (F2 §06 adaptation; enum never altered).
 */
export const skills = mysqlTable(
  'skills',
  {
    skillId: int('skill_id').autoincrement().primaryKey(),
    skillName: varchar('skill_name', { length: 100 }).notNull(),
    category: mysqlEnum('category', [
      'offensive',
      'defensive',
      'forensics',
      'networking',
      'web',
      'mobile',
      'cloud',
      'ai_ml',
      'governance',
    ]).notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('skills_skill_name_key').on(table.skillName)],
);

/**
 * `user_skills` — Skill proficiency mapping (USR-05/06/07). Composite PK
 * (user_id, skill_id) prevents duplicate skill rows per user.
 */
export const userSkills = mysqlTable(
  'user_skills',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    skillId: int('skill_id')
      .notNull()
      .references(() => skills.skillId, { onDelete: 'cascade' }),
    proficiencyLevel: mysqlEnum('proficiency_level', [
      'beginner',
      'intermediate',
      'advanced',
      'expert',
    ])
      .notNull()
      .default('beginner'),
    yearsExperience: decimal('years_experience', { precision: 3, scale: 1 }).notNull().default('0'),
    isVerified: boolean('is_verified').notNull().default(false),
    endorsedBy: int('endorsed_by'),
    endorsedAt: timestamp('endorsed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skillId] })],
);

/**
 * `user_follows` — Follow/unfollow social graph (USR-11/12). Composite PK
 * (follower_id, following_id); the SQL CHECK (follower_id != following_id)
 * is pre-validated in the service layer.
 */
export const userFollows = mysqlTable(
  'user_follows',
  {
    followerId: int('follower_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    followingId: int('following_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    followedAt: timestamp('followed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.followerId, table.followingId] })],
);

/**
 * `user_settings` — Per-user preference key/value store (USR-08/09).
 * `setting_value` is JSON; UPSERT keyed on (user_id, setting_key).
 */
export const userSettings = mysqlTable(
  'user_settings',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    settingKey: varchar('setting_key', { length: 100 }).notNull(),
    settingValue: json('setting_value'),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.settingKey] })],
);

/**
 * `system_settings` — Platform configuration store (ADM-08/09).
 * `is_editable = false` records are read-only; PATCH attempts return 403.
 */
export const systemSettings = mysqlTable(
  'system_settings',
  {
    settingId: int('setting_id').autoincrement().primaryKey(),
    settingKey: varchar('setting_key', { length: 100 }).notNull(),
    settingValue: json('setting_value'),
    groupName: varchar('group_name', { length: 50 }),
    description: text('description'),
    isEditable: boolean('is_editable').notNull().default(true),
    updatedBy: int('updated_by'),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('system_settings_setting_key_key').on(table.settingKey)],
);

/**
 * `audit_logs` — Platform admin mutation audit trail (ADM-07). Every ban,
 * unban, soft-delete and settings change writes a row with before/after
 * `changes` JSON.
 */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    logId: int('log_id').autoincrement().primaryKey(),
    adminUserId: int('admin_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    action: varchar('action', { length: 50 }).notNull(),
    targetType: varchar('target_type', { length: 50 }),
    targetId: int('target_id'),
    changes: json('changes'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_admin').on(table.adminUserId),
    index('idx_action').on(table.action),
    index('idx_created').on(table.createdAt),
  ],
);

/**
 * `files` — Uploaded avatar/cover file records (USR-03/04). The row is
 * persisted BEFORE `users.avatar_url` / `users.cover_photo_url` is updated
 * (broken references are forbidden, F2 §05 invariant 2).
 */
export const files = mysqlTable(
  'files',
  {
    fileId: int('file_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    filePath: varchar('file_path', { length: 255 }).notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    mimeType: varchar('mime_type', { length: 100 }),
    fileHash: varchar('file_hash', { length: 64 }),
    storageType: mysqlEnum('storage_type', ['local', 's3', 'azure', 'gcs'])
      .notNull()
      .default('local'),
    bucketName: varchar('bucket_name', { length: 100 }),
    objectKey: varchar('object_key', { length: 255 }),
    isPublic: boolean('is_public').notNull().default(false),
    uploadIp: varchar('upload_ip', { length: 45 }),
    downloadsCount: int('downloads_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_user').on(table.userId)],
);

export const countriesRelations = relations(countries, ({ many }) => ({
  profiles: many(userProfiles),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.userId] }),
  country: one(countries, { fields: [userProfiles.countryId], references: [countries.countryId] }),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  userSkills: many(userSkills),
}));

export const userSkillsRelations = relations(userSkills, ({ one }) => ({
  user: one(users, { fields: [userSkills.userId], references: [users.userId] }),
  skill: one(skills, { fields: [userSkills.skillId], references: [skills.skillId] }),
}));

export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  follower: one(users, {
    fields: [userFollows.followerId],
    references: [users.userId],
    relationName: 'user_followers',
  }),
  following: one(users, {
    fields: [userFollows.followingId],
    references: [users.userId],
    relationName: 'user_following',
  }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.userId] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  admin: one(users, { fields: [auditLogs.adminUserId], references: [users.userId] }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  user: one(users, { fields: [files.userId], references: [users.userId] }),
}));

/**
 * `organizations` — Enterprise organization records (F3 domain). Mapped here
 * because ADM-06 dashboard KPIs count organizations (F2 §06 derived entity).
 * No runtime coupling to F3: only a COUNT(*) aggregate is used.
 */
export const organizations = mysqlTable(
  'organizations',
  {
    organizationId: int('organization_id').autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),
    logoUrl: varchar('logo_url', { length: 255 }),
    website: varchar('website', { length: 255 }),
    industry: varchar('industry', { length: 100 }),
    employeeCount: int('employee_count'),
    isVerified: boolean('is_verified').notNull().default(false),
    billingEmail: varchar('billing_email', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('organizations_name_key').on(table.name),
    uniqueIndex('organizations_slug_key').on(table.slug),
    index('idx_name').on(table.name),
  ],
);

/**
 * `teams` — Adapted as Classes (F3 §06 mapping). A DevOps Mentor class is a
 * `teams` row with `is_public = false` and `organization_id` bound to its
 * organization. `team_owner_id` holds the primary professor's `user_id`
 * (created-by user until a professor is assigned via CLS-05).
 *
 * Sentinel row: a global team with `slug = '__org_invites__'` and a NULL
 * `organization_id` anchors org-level professor invitations in
 * `team_invitations` (the column is NOT NULL with an FK to teams). Because
 * org-scoped queries filter `organization_id = :orgId`, the NULL sentinel is
 * never returned by class listings.
 */
export const teams = mysqlTable(
  'teams',
  {
    teamId: int('team_id').autoincrement().primaryKey(),
    organizationId: int('organization_id').references(
      () => organizations.organizationId,
      { onDelete: 'set null' },
    ),
    teamName: varchar('team_name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    logoUrl: varchar('logo_url', { length: 255 }),
    teamOwnerId: int('team_owner_id')
      .notNull()
      .references(() => users.userId),
    isPublic: boolean('is_public').notNull().default(false),
    maxMembers: int('max_members').notNull().default(50),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('teams_slug_key').on(table.slug),
    index('idx_org').on(table.organizationId),
  ],
);

/**
 * `team_members` — Adapted as Enrollments (F3 §06 mapping). Students are
 * `role = 'member'` rows; primary professors are `role = 'captain'` and
 * secondary professors `role = 'co_captain'`. Withdrawal sets `is_active =
 * false` and `left_at = NOW()`; the historical row is never hard-deleted.
 */
export const teamMembers = mysqlTable(
  'team_members',
  {
    teamId: int('team_id')
      .notNull()
      .references(() => teams.teamId, { onDelete: 'cascade' }),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['member', 'captain', 'co_captain', 'manager'])
      .notNull()
      .default('member'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    leftAt: timestamp('left_at'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index('idx_user').on(table.userId),
  ],
);

/**
 * `team_invitations` — Adapted as Class Invitations (F3 §06 mapping). Student
 * invitations reference the class `team_id`; org-level professor invitations
 * reference the global sentinel team (`__org_invites__`), with the org
 * resolved from the inviter's scope at acceptance time. Tokens expire after
 * 72 hours; a single email cannot hold two pending invites to the same class.
 */
export const teamInvitations = mysqlTable(
  'team_invitations',
  {
    invitationId: int('invitation_id').autoincrement().primaryKey(),
    teamId: int('team_id')
      .notNull()
      .references(() => teams.teamId, { onDelete: 'cascade' }),
    inviterId: int('inviter_id')
      .notNull()
      .references(() => users.userId),
    inviteeEmail: varchar('invitee_email', { length: 255 }).notNull(),
    inviteeUserId: int('invitee_user_id').references(() => users.userId, {
      onDelete: 'set null',
    }),
    token: varchar('token', { length: 255 }).notNull(),
    status: mysqlEnum('status', ['pending', 'accepted', 'declined', 'expired'])
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at'),
  },
  (table) => [
    uniqueIndex('team_invitations_token_key').on(table.token),
    index('idx_token').on(table.token),
    index('idx_email').on(table.inviteeEmail),
  ],
);