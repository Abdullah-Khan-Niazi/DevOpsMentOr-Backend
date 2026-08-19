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
  longtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';

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
/* ────────────────────────────────────────────────────────────────────────────
 * F4 — Canonical Curriculum & Course Content (§06 embedded DB mapping).
 * Tables mirror CREATE TABLE statements in devops_db.sql verbatim.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `difficulty_levels` — Curriculum difficulty taxonomy (F4 §06 reuse).
 * Pre-seeded: Very Easy → Insane. `level_value` ranks difficulties;
 * `is_active` gates visibility. Read-only for F4; referenced by
 * `academy_courses.difficulty_id`.
 */
export const difficultyLevels = mysqlTable(
  'difficulty_levels',
  {
    difficultyId: int('difficulty_id').autoincrement().primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    levelValue: int('level_value').notNull(),
    colorHex: varchar('color_hex', { length: 7 }),
    iconClass: varchar('icon_class', { length: 50 }),
    pointsMultiplier: decimal('points_multiplier', { precision: 3, scale: 2 }).default('1.00'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('difficulty_levels_name_key').on(table.name),
    uniqueIndex('difficulty_levels_level_value_key').on(table.levelValue),
  ],
);

/**
 * `categories` — Content taxonomy (F4 §06 reuse). Pre-seeded: Cloud, Web,
 * etc. Supports a single-level self hierarchy via `parent_category_id`;
 * `display_order` drives catalog ordering.
 */
export const categories = mysqlTable(
  'categories',
  {
    categoryId: int('category_id').autoincrement().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    iconUrl: varchar('icon_url', { length: 255 }),
    parentCategoryId: int('parent_category_id').references(
      (): AnyMySqlColumn => categories.categoryId,
      { onDelete: 'cascade' },
    ),
    displayOrder: int('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('categories_name_key').on(table.name),
    uniqueIndex('categories_slug_key').on(table.slug),
  ],
);

/**
 * `tags` — Lesson tag vocabulary (F4 §06 reuse). A flat set of named tags
 * linked to lessons through the polymorphic `challenge_tags` mapping.
 */
export const tags = mysqlTable(
  'tags',
  {
    tagId: int('tag_id').autoincrement().primaryKey(),
    tagName: varchar('tag_name', { length: 50 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    colorHex: varchar('color_hex', { length: 7 }).notNull().default('#6c757d'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tags_tag_name_key').on(table.tagName),
    uniqueIndex('tags_slug_key').on(table.slug),
  ],
);

/**
 * `academy_courses` — The canonical course entity (F4 §05 invariant 1).
 * EXACTLY ONE row per deployment; created idempotently by the admin course
 * endpoint. `difficulty_id` is NOT NULL (FK to difficulty_levels);
 * `prerequisites` and `learning_objectives` are JSON arrays.
 */
export const academyCourses = mysqlTable(
  'academy_courses',
  {
    courseId: int('course_id').autoincrement().primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: text('description'),
    difficultyId: int('difficulty_id')
      .notNull()
      .references(() => difficultyLevels.difficultyId),
    categoryId: int('category_id').references(() => categories.categoryId),
    instructorId: int('instructor_id')
      .notNull()
      .references(() => users.userId),
    coverImageUrl: varchar('cover_image_url', { length: 255 }),
    videoTrailerUrl: varchar('video_trailer_url', { length: 255 }),
    estimatedHours: int('estimated_hours').notNull().default(0),
    totalLessons: int('total_lessons').notNull().default(0),
    totalQuizzes: int('total_quizzes').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(false),
    isPremium: boolean('is_premium').notNull().default(false),
    price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0'),
    discountPrice: decimal('discount_price', { precision: 10, scale: 2 }),
    averageRating: decimal('average_rating', { precision: 3, scale: 2 }).notNull().default('0'),
    totalRatings: int('total_ratings').notNull().default(0),
    enrollmentCount: int('enrollment_count').notNull().default(0),
    prerequisites: json('prerequisites').$type<string[] | null>(),
    learningObjectives: json('learning_objectives').$type<string[] | null>(),
    releaseDate: date('release_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('academy_courses_slug_key').on(table.slug),
  ],
);

/**
 * `modules` — Course modules (F4 §05). `module_order` is unique within the
 * course (invariant 2). `is_published = FALSE` represents both DRAFT and
 * ARCHIVED states; archiving cascades to children (invariant 5).
 */
export const modules = mysqlTable(
  'modules',
  {
    moduleId: int('module_id').autoincrement().primaryKey(),
    courseId: int('course_id')
      .notNull()
      .references(() => academyCourses.courseId, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    moduleOrder: int('module_order').notNull(),
    estimatedMinutes: int('estimated_minutes').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_course_order').on(table.courseId, table.moduleOrder),
  ],
);

/**
 * `lessons` — Module lessons (F4 §05). `content_type` drives rendering
 * (text | video | interactive | lab; lab links to F6 definitions).
 * `lesson_order` is unique within the module (invariant 3). Lessons are
 * never hard-deleted; removal unpublishes and re-orders (invariant 10).
 */
export const lessons = mysqlTable(
  'lessons',
  {
    lessonId: int('lesson_id').autoincrement().primaryKey(),
    moduleId: int('module_id')
      .notNull()
      .references(() => modules.moduleId, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    content: longtext('content'),
    contentType: mysqlEnum('content_type', ['text', 'video', 'interactive', 'lab'])
      .notNull()
      .default('text'),
    videoUrl: varchar('video_url', { length: 255 }),
    videoDurationSeconds: int('video_duration_seconds'),
    lessonOrder: int('lesson_order').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_module_order').on(table.moduleId, table.lessonOrder),
  ],
);

/**
 * `challenge_tags` — Polymorphic lesson→tag mapping (F4 §06 adaptation).
 * The `challenge_id` column is repurposed to hold `lessons.lesson_id`;
 * each row joins a lesson to a `tags` row. No schema change was needed.
 * Declared after `lessons` because the FK callback is evaluated at import.
 */
export const challengeTags = mysqlTable(
  'challenge_tags',
  {
    challengeId: int('challenge_id')
      .notNull()
      .references((): AnyMySqlColumn => lessons.lessonId, { onDelete: 'cascade' }),
    tagId: int('tag_id')
      .notNull()
      .references((): AnyMySqlColumn => tags.tagId, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.challengeId, table.tagId] }),
    index('idx_tag').on(table.tagId),
  ],
);

/**
 * `quizzes` — Module-level quizzes (F4 §05). `passing_score` is a 0-100
 * percentage; `is_required` marks gate quizzes. Publish requires the parent
 * module to be published (invariant 4).
 */
export const quizzes = mysqlTable(
  'quizzes',
  {
    quizId: int('quiz_id').autoincrement().primaryKey(),
    moduleId: int('module_id')
      .notNull()
      .references(() => modules.moduleId, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    passingScore: int('passing_score').notNull().default(70),
    timeLimitMinutes: int('time_limit_minutes'),
    isRequired: boolean('is_required').notNull().default(true),
    isPublished: boolean('is_published').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_quiz_module').on(table.moduleId),
  ],
);

/**
 * `quiz_questions` — Question bank per quiz (F4 §05). `question_type`
 * controls the answer-correctness invariant (invariant 6) and answer
 * stripping for non-admin responses. `is_active = FALSE` soft-hides a
 * question without deleting it.
 */
export const quizQuestions = mysqlTable(
  'quiz_questions',
  {
    questionId: int('question_id').autoincrement().primaryKey(),
    quizId: int('quiz_id')
      .notNull()
      .references(() => quizzes.quizId, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    questionType: mysqlEnum('question_type', [
      'multiple_choice',
      'true_false',
      'fill_blank',
      'multiple_select',
    ])
      .notNull()
      .default('multiple_choice'),
    points: int('points').notNull().default(10),
    explanation: text('explanation'),
    questionOrder: int('question_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_quiz_order').on(table.quizId, table.questionOrder),
  ],
);

/**
 * `quiz_answers` — Answer options per question (F4 §05). `is_correct` is
 * NEVER exposed to learner roles; stripped at the service boundary.
 */
export const quizAnswers = mysqlTable(
  'quiz_answers',
  {
    answerId: int('answer_id').autoincrement().primaryKey(),
    questionId: int('question_id')
      .notNull()
      .references(() => quizQuestions.questionId, { onDelete: 'cascade' }),
    answerText: text('answer_text').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    answerOrder: int('answer_order').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_question').on(table.questionId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────────
 * F5 — Learning Experience & Progress Tracking (§06 embedded DB mapping).
 * Tables mirror CREATE TABLE statements in devops_db.sql verbatim; no schema
 * alteration was required (the §06 adaptation is entirely at the query level).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `user_progress` — Multi-grain progress rows (F5 §06). A row with all three
 * IDs populated is lesson-grain progress; `lesson_id IS NULL` with
 * `module_id` set is module-grain; both `lesson_id` and `module_id` NULL is
 * course-grain rollup. The source schema has NO unique index, so the F5
 * service enforces (user_id, lesson_id) uniqueness via an application-level
 * select-then-write upsert inside a transaction.
 */
export const userProgress = mysqlTable(
  'user_progress',
  {
    progressId: int('progress_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    courseId: int('course_id').references(() => academyCourses.courseId, {
      onDelete: 'cascade',
    }),
    moduleId: int('module_id').references(() => modules.moduleId, { onDelete: 'cascade' }),
    lessonId: int('lesson_id').references(() => lessons.lessonId, { onDelete: 'cascade' }),
    progressPercentage: decimal('progress_percentage', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at'),
    lastAccessedAt: timestamp('last_accessed_at').notNull().defaultNow(),
    timeSpentSeconds: int('time_spent_seconds').notNull().default(0),
  },
  (table) => [
    index('idx_up_user').on(table.userId),
    index('idx_up_module').on(table.moduleId),
    index('idx_up_lesson').on(table.lessonId),
  ],
);

/**
 * `quiz_attempts` — Quiz session records per user per quiz (F5 §06).
 * `attempt_number` increments per (user_id, quiz_id); `score` is a 0-100
 * percentage; `is_passed` is evaluated against `quizzes.passing_score` at
 * submission time.
 */
export const quizAttempts = mysqlTable(
  'quiz_attempts',
  {
    attemptId: int('attempt_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    quizId: int('quiz_id')
      .notNull()
      .references(() => quizzes.quizId, { onDelete: 'cascade' }),
    score: int('score').notNull().default(0),
    isPassed: boolean('is_passed').notNull().default(false),
    attemptNumber: int('attempt_number').notNull().default(1),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    timeTakenSeconds: int('time_taken_seconds'),
  },
  (table) => [
    index('idx_qa_user_quiz').on(table.userId, table.quizId),
  ],
);

/**
 * `user_quiz_answers` — Per-question answer records per attempt (F5 §06).
 * `answer_id` is NULL for fill_blank questions; `answer_text` carries the
 * free-text response; `points_earned` is written at scoring time.
 */
export const userQuizAnswers = mysqlTable(
  'user_quiz_answers',
  {
    userAnswerId: int('user_answer_id').autoincrement().primaryKey(),
    attemptId: int('attempt_id')
      .notNull()
      .references(() => quizAttempts.attemptId, { onDelete: 'cascade' }),
    questionId: int('question_id')
      .notNull()
      .references(() => quizQuestions.questionId),
    answerId: int('answer_id').references(() => quizAnswers.answerId),
    isCorrect: boolean('is_correct').notNull().default(false),
    answerText: text('answer_text'),
    pointsEarned: int('points_earned').notNull().default(0),
    answeredAt: timestamp('answered_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_uqa_attempt').on(table.attemptId),
  ],
);

/**
 * `activity_logs` — Learner event history (F5 §06). `activity_type` holds the
 * `LearningActivityType` string enum verbatim; `details` carries structured
 * event context such as `{ lessonId, moduleId, score }`. Written by
 * ActivityLogService (F5) and by F6 via the `recordEvent` forward hook.
 */
export const activityLogs = mysqlTable(
  'activity_logs',
  {
    logId: int('log_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    activityType: varchar('activity_type', { length: 50 }).notNull(),
    details: json('details').$type<Record<string, unknown> | null>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_al_user').on(table.userId),
    index('idx_al_type').on(table.activityType),
    index('idx_al_created').on(table.createdAt),
  ],
);

export const userProgressRelations = relations(userProgress, ({ one }) => ({
  user: one(users, { fields: [userProgress.userId], references: [users.userId] }),
  course: one(academyCourses, {
    fields: [userProgress.courseId],
    references: [academyCourses.courseId],
  }),
  module: one(modules, { fields: [userProgress.moduleId], references: [modules.moduleId] }),
  lesson: one(lessons, { fields: [userProgress.lessonId], references: [lessons.lessonId] }),
}));

export const quizAttemptsRelations = relations(quizAttempts, ({ one, many }) => ({
  user: one(users, { fields: [quizAttempts.userId], references: [users.userId] }),
  quiz: one(quizzes, { fields: [quizAttempts.quizId], references: [quizzes.quizId] }),
  answers: many(userQuizAnswers),
}));

export const userQuizAnswersRelations = relations(userQuizAnswers, ({ one }) => ({
  attempt: one(quizAttempts, {
    fields: [userQuizAnswers.attemptId],
    references: [quizAttempts.attemptId],
  }),
  question: one(quizQuestions, {
    fields: [userQuizAnswers.questionId],
    references: [quizQuestions.questionId],
  }),
  answer: one(quizAnswers, {
    fields: [userQuizAnswers.answerId],
    references: [quizAnswers.answerId],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, { fields: [activityLogs.userId], references: [users.userId] }),
}));

/**
 * `labs` — DevOps lab catalog (F6 §06 direct reuse). `lab_type` restricts the
 * deployment to `pro_lab` (full infrastructure lab), `sherlock`
 * (troubleshooting diagnostic lab) and `vip_lab` (premium guided environment);
 * the SQL enum additionally carries `fortress` which is cybersecurity-domain
 * and unused in DevOps Mentor. `is_premium` feeds the F9 entitlement gate.
 */
export const labs = mysqlTable(
  'labs',
  {
    labId: int('lab_id').autoincrement().primaryKey(),
    labName: varchar('lab_name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    difficultyId: int('difficulty_id')
      .notNull()
      .references(() => difficultyLevels.difficultyId),
    categoryId: int('category_id').references(() => categories.categoryId),
    labType: mysqlEnum('lab_type', ['pro_lab', 'fortress', 'sherlock', 'vip_lab']).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isPremium: boolean('is_premium').notNull().default(false),
    estimatedHours: int('estimated_hours').notNull().default(0),
    networkDiagramUrl: varchar('network_diagram_url', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('labs_lab_name_key').on(table.labName),
    uniqueIndex('labs_slug_key').on(table.slug),
    index('idx_labs_difficulty').on(table.difficultyId),
  ],
);

/**
 * `pro_labs` — Infrastructure lab extension (F6 §06 adaptation).
 * `required_root_count` is adapted as the required completed assertion count;
 * `flag_values` JSON is adapted as `{ "checkpointId": "assertionGroupId" }`
 * checkpoint identifiers consumed server-side by the assertion engine.
 */
export const proLabs = mysqlTable(
  'pro_labs',
  {
    proLabId: int('pro_lab_id').autoincrement().primaryKey(),
    labId: int('lab_id')
      .notNull()
      .references(() => labs.labId, { onDelete: 'cascade' }),
    networkIpRange: varchar('network_ip_range', { length: 50 }),
    totalMachines: int('total_machines').notNull().default(0),
    requiredRootCount: int('required_root_count').notNull().default(0),
    flagValues: json('flag_values').$type<Record<string, string> | null>(),
    activeUsersCount: int('active_users_count').notNull().default(0),
  },
  (table) => [uniqueIndex('pro_labs_lab_id_key').on(table.labId)],
);

/**
 * `sherlocks` — Troubleshooting/diagnostic lab extension (F6 §06 adaptation).
 * `questions` JSON holds `[{ id, text, hint? }]`; `answers` JSON holds
 * `[{ id, answer }]` and is SERVER-SIDE ONLY: it is never returned by any
 * API response (F6 §05 invariant 5).
 */
export const sherlocks = mysqlTable(
  'sherlocks',
  {
    sherlockId: int('sherlock_id').autoincrement().primaryKey(),
    labId: int('lab_id')
      .notNull()
      .references(() => labs.labId, { onDelete: 'cascade' }),
    evidenceFileUrl: varchar('evidence_file_url', { length: 255 }),
    evidenceFileSize: bigint('evidence_file_size', { mode: 'number' }),
    fileHash: varchar('file_hash', { length: 64 }),
    questions: json('questions').$type<Array<{ id: string; text: string; hint?: string }> | null>(),
    answers: json('answers').$type<Array<{ id: string; answer: string }> | null>(),
    requiredCorrectAnswers: int('required_correct_answers').notNull().default(0),
  },
  (table) => [uniqueIndex('sherlocks_lab_id_key').on(table.labId)],
);

/**
 * `vpn_servers` — Lab network infrastructure pool (F6 §06 direct reuse).
 * `region` ENUM defines the geographic pool; `current_users` is incremented
 * atomically on assignment and decremented on teardown (F6 §05 invariants
 * 6 and 7).
 */
export const vpnServers = mysqlTable(
  'vpn_servers',
  {
    vpnId: int('vpn_id').autoincrement().primaryKey(),
    serverName: varchar('server_name', { length: 100 }).notNull(),
    serverLocation: varchar('server_location', { length: 100 }),
    countryId: int('country_id').references(() => countries.countryId),
    ipAddress: varchar('ip_address', { length: 15 }),
    port: int('port').notNull().default(443),
    region: mysqlEnum('region', ['US', 'EU', 'ASIA', 'AUSTRALIA', 'SOUTH_AMERICA', 'AFRICA'])
      .notNull(),
    maxUsers: int('max_users').notNull().default(100),
    currentUsers: int('current_users').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isMaintenance: boolean('is_maintenance').notNull().default(false),
    loadBalancerUrl: varchar('load_balancer_url', { length: 255 }),
    status: mysqlEnum('status', ['online', 'offline', 'degraded']).notNull().default('online'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_vpn_region').on(table.region)],
);

/**
 * `vpn_assignments` — User to VPN server binding (F6 §06 direct reuse).
 * `ovpn_config_url` holds a time-limited signed download URL; ownership is
 * always verified as `user_id = session.userId`.
 */
export const vpnAssignments = mysqlTable(
  'vpn_assignments',
  {
    assignmentId: int('assignment_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    vpnId: int('vpn_id')
      .notNull()
      .references(() => vpnServers.vpnId),
    assignedIp: varchar('assigned_ip', { length: 15 }),
    ovpnConfigUrl: varchar('ovpn_config_url', { length: 255 }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [index('idx_vpn_assignments_user').on(table.userId)],
);

/**
 * `pwnbox_instances` — Browser-native lab instance (F6 §06 adaptation).
 * Container type is Docker/Kubernetes pods: `hostname` = pod DNS,
 * `assigned_ip` = pod cluster IP, `ssh_port` = mapped NodePort,
 * `root_password` = ephemeral initial credential returned ONCE at provision
 * time (F6 §05 invariants 2 and 3). Every row carries an `expires_at` TTL
 * enforced by the TTL monitor job. The lab association is recovered from the
 * LAB_STARTED activity event (`details.labId`); the SQL table has no
 * `lab_id` column.
 */
export const pwnboxInstances = mysqlTable(
  'pwnbox_instances',
  {
    instanceId: int('instance_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    vpnId: int('vpn_id')
      .notNull()
      .references(() => vpnServers.vpnId),
    hostname: varchar('hostname', { length: 100 }),
    assignedIp: varchar('assigned_ip', { length: 15 }),
    sshPort: int('ssh_port').notNull().default(22),
    rootPassword: varchar('root_password', { length: 255 }),
    ramGb: int('ram_gb').notNull().default(2),
    cpuCores: int('cpu_cores').notNull().default(2),
    diskGb: int('disk_gb').notNull().default(20),
    status: mysqlEnum('status', ['pending', 'running', 'stopped', 'terminated', 'error'])
      .notNull()
      .default('pending'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    terminatedAt: timestamp('terminated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_pi_user').on(table.userId), index('idx_pi_status').on(table.status)],
);

/**
 * `tracks` — Learning path catalog (F6 §06 direct reuse). `total_machines`
 * and `total_challenges` hold zero in DevOps Mentor; only `total_labs` and
 * course counts are populated.
 */
export const tracks = mysqlTable(
  'tracks',
  {
    trackId: int('track_id').autoincrement().primaryKey(),
    trackName: varchar('track_name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    difficultyId: int('difficulty_id')
      .notNull()
      .references(() => difficultyLevels.difficultyId),
    categoryId: int('category_id').references(() => categories.categoryId),
    totalMachines: int('total_machines').notNull().default(0),
    totalChallenges: int('total_challenges').notNull().default(0),
    totalLabs: int('total_labs').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isPremium: boolean('is_premium').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('tracks_track_name_key').on(table.trackName),
    uniqueIndex('tracks_slug_key').on(table.slug),
  ],
);

/**
 * `track_content` — Ordered track item mapping (F6 §06 direct reuse).
 * `content_type` is restricted to `'lab'` and `'course'` at the Zod
 * validation layer (F6 §05 invariant 12); `machine` and `challenge` are
 * cybersecurity-domain and rejected with 422.
 */
export const trackContent = mysqlTable(
  'track_content',
  {
    trackId: int('track_id')
      .notNull()
      .references(() => tracks.trackId, { onDelete: 'cascade' }),
    contentType: mysqlEnum('content_type', ['machine', 'challenge', 'lab', 'course']).notNull(),
    contentId: int('content_id').notNull(),
    displayOrder: int('display_order').notNull(),
    required: boolean('required').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.contentType, table.contentId] }),
    index('idx_tc_track').on(table.trackId),
  ],
);

export const labsRelations = relations(labs, ({ one, many }) => ({
  difficulty: one(difficultyLevels, { fields: [labs.difficultyId], references: [difficultyLevels.difficultyId] }),
  category: one(categories, { fields: [labs.categoryId], references: [categories.categoryId] }),
  proLab: one(proLabs, { fields: [labs.labId], references: [proLabs.labId] }),
  sherlock: one(sherlocks, { fields: [labs.labId], references: [sherlocks.labId] }),
  instances: many(pwnboxInstances),
}));

export const proLabsRelations = relations(proLabs, ({ one }) => ({
  lab: one(labs, { fields: [proLabs.labId], references: [labs.labId] }),
}));

export const sherlocksRelations = relations(sherlocks, ({ one }) => ({
  lab: one(labs, { fields: [sherlocks.labId], references: [labs.labId] }),
}));

export const vpnServersRelations = relations(vpnServers, ({ one, many }) => ({
  country: one(countries, { fields: [vpnServers.countryId], references: [countries.countryId] }),
  assignments: many(vpnAssignments),
}));

export const vpnAssignmentsRelations = relations(vpnAssignments, ({ one }) => ({
  user: one(users, { fields: [vpnAssignments.userId], references: [users.userId] }),
  server: one(vpnServers, { fields: [vpnAssignments.vpnId], references: [vpnServers.vpnId] }),
}));

export const pwnboxInstancesRelations = relations(pwnboxInstances, ({ one }) => ({
  user: one(users, { fields: [pwnboxInstances.userId], references: [users.userId] }),
  server: one(vpnServers, { fields: [pwnboxInstances.vpnId], references: [vpnServers.vpnId] }),
}));

export const tracksRelations = relations(tracks, ({ one, many }) => ({
  difficulty: one(difficultyLevels, { fields: [tracks.difficultyId], references: [difficultyLevels.difficultyId] }),
  category: one(categories, { fields: [tracks.categoryId], references: [categories.categoryId] }),
  content: many(trackContent),
}));

export const trackContentRelations = relations(trackContent, ({ one }) => ({
  track: one(tracks, { fields: [trackContent.trackId], references: [tracks.trackId] }),
}));

/**
 * `subscriptions` — Individual and organization plan entitlement records
 * (F9 §06 direct reuse). `organization_id` is NULL for individual plans and
 * populated for org-level subscriptions; `plan_type` ENUM covers Free,
 * Premium, Enterprise and Student tiers. `is_active = TRUE` plus
 * `end_date > NOW()` defines the authoritative "active subscription" state
 * consumed by EntitlementService (F5/F6 gate) and the nightly expiry job.
 * On cancellation `cancelled_at` and `auto_renew = FALSE` are set while
 * `is_active` remains TRUE until `end_date` passes (invariant 12, AC-09).
 * At most one active subscription per user is enforced by the application
 * layer (invariant 1); an org admin may additionally hold an org
 * subscription.
 */
export const subscriptions = mysqlTable(
  'subscriptions',
  {
    subscriptionId: int('subscription_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    organizationId: int('organization_id').references(() => organizations.organizationId, {
      onDelete: 'cascade',
    }),
    planName: varchar('plan_name', { length: 50 }).notNull(),
    planType: mysqlEnum('plan_type', ['free', 'premium', 'enterprise', 'student']).notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    startDate: timestamp('start_date').notNull(),
    endDate: timestamp('end_date'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    cancelledAt: timestamp('cancelled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_sub_user').on(table.userId), index('idx_sub_active').on(table.isActive)],
);

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.userId] }),
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.organizationId],
  }),
  orders: many(orders),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * F9 — Subscription, Billing & Entitlements (§06 embedded DB mapping).
 * Tables mirror CREATE TABLE statements in devops_db.sql verbatim; no schema
 * alteration was required. `invoices.pdf_data` LONGBLOB is intentionally
 * unmapped for writes: PDF storage is external and `invoice_url` holds the
 * reference (F9 §05 invariant 14, AC-11).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `payment_methods` — Tokenized payment instrument vault (F9 §06 direct
 * reuse). Only Stripe token references are stored: `last4_digits`,
 * `card_brand` and `stripe_payment_method_id`. Raw card numbers, CVVs and
 * full PANs NEVER reach this table or any F9 code path (absolute security
 * invariant, AC-07). `method_type` uses `'credit_card'`, `'paypal'` and
 * `'enterprise_invoice'` in V1; `'crypto'` and `'bank_transfer'` are
 * reserved for future use. Exactly one `is_default = TRUE` row is enforced
 * per user by the application layer (invariant 9).
 */
export const paymentMethods = mysqlTable(
  'payment_methods',
  {
    paymentMethodId: int('payment_method_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    methodType: mysqlEnum('method_type', [
      'credit_card',
      'paypal',
      'crypto',
      'bank_transfer',
      'enterprise_invoice',
    ]).notNull(),
    last4Digits: varchar('last4_digits', { length: 4 }),
    cardBrand: varchar('card_brand', { length: 20 }),
    stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }),
    paypalEmail: varchar('paypal_email', { length: 255 }),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_pm_user').on(table.userId)],
);

/**
 * `coupons` — Discount code catalog (F9 §06 direct reuse). Codes are stored
 * in uppercase (normalized at INSERT) and compared case-insensitively at
 * validation (invariant 4). `used_count` increments are atomic:
 * `UPDATE coupons SET used_count = used_count + 1 WHERE used_count <
 * max_uses` (invariant 3, AC-03), preventing over-redemption under
 * concurrent requests.
 */
export const coupons = mysqlTable(
  'coupons',
  {
    couponId: int('coupon_id').autoincrement().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    description: text('description'),
    discountType: mysqlEnum('discount_type', ['percentage', 'fixed_amount']).notNull(),
    discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull(),
    maxUses: int('max_uses').notNull().default(1),
    usedCount: int('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coupons_code_key').on(table.code),
    index('idx_coupons_code').on(table.code),
  ],
);

/**
 * `orders` — Purchase transaction records (F9 §06 direct reuse). One order is
 * created per subscription purchase; `status` follows the state machine
 * `pending → paid / failed / refunded / cancelled`. `order_number` is a
 * unique sequence `DM-ORD-{YYYY}-{NNNNNN}` (invariant 6). `final_amount` is
 * computed once at creation (`total - discount + tax`) and never recomputed
 * (invariant 5). `stripe_payment_intent_id` reconciles the row with Stripe
 * webhook events.
 */
export const orders = mysqlTable(
  'orders',
  {
    orderId: int('order_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    subscriptionId: int('subscription_id').references(() => subscriptions.subscriptionId, {
      onDelete: 'set null',
    }),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    finalAmount: decimal('final_amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    status: mysqlEnum('status', ['pending', 'paid', 'failed', 'refunded', 'cancelled']).notNull().default('pending'),
    paymentMethodId: int('payment_method_id').references(() => paymentMethods.paymentMethodId, {
      onDelete: 'set null',
    }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_order_number_key').on(table.orderNumber),
    index('idx_orders_user').on(table.userId),
    index('idx_orders_order_number').on(table.orderNumber),
  ],
);

/**
 * `invoices` — Billing invoices (F9 §06 direct reuse). `invoice_number` is a
 * unique sequence `DM-INV-{YYYY}-{NNNNNN}` (invariant 7). `invoice_url`
 * stores the signed URL to the externally generated PDF; the `pdf_data`
 * LONGBLOB column exists in the SQL source but is NEVER written by any F9
 * code path (invariant 14, AC-11).
 */
export const invoices = mysqlTable(
  'invoices',
  {
    invoiceId: int('invoice_id').autoincrement().primaryKey(),
    orderId: int('order_id')
      .notNull()
      .references(() => orders.orderId, { onDelete: 'cascade' }),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    invoiceUrl: varchar('invoice_url', { length: 255 }),
    dueDate: timestamp('due_date'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_key').on(table.invoiceNumber),
    index('idx_invoices_invoice_number').on(table.invoiceNumber),
  ],
);

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  user: one(users, { fields: [paymentMethods.userId], references: [users.userId] }),
}));

export const couponsRelations = relations(coupons, () => ({}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.userId] }),
  subscription: one(subscriptions, {
    fields: [orders.subscriptionId],
    references: [subscriptions.subscriptionId],
  }),
  paymentMethod: one(paymentMethods, {
    fields: [orders.paymentMethodId],
    references: [paymentMethods.paymentMethodId],
  }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, { fields: [invoices.orderId], references: [orders.orderId] }),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * F7 — Achievements, Gamification & Certification (§06 embedded DB mapping).
 * Tables mirror CREATE TABLE statements in devops_db.sql verbatim; no schema
 * alteration was required. Cybersecurity-domain columns on reused tables are
 * documented but permanently held at zero by the application.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `badges` — Badge catalog (F7 §06 direct reuse). `badge_type` ENUM defines the
 * visual tier (bronze → special); `points_required` is the point reward credited
 * when the badge is awarded; `criteria` JSON holds the auto-award trigger rule
 * `{ triggerType, triggerValue }`. `is_hidden = TRUE` badges are awarded by the
 * engine but stripped from every learner-facing response (invariant 8).
 */
export const badges = mysqlTable(
  'badges',
  {
    badgeId: int('badge_id').autoincrement().primaryKey(),
    badgeName: varchar('badge_name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    badgeType: mysqlEnum('badge_type', [
      'bronze',
      'silver',
      'gold',
      'platinum',
      'diamond',
      'special',
    ])
      .notNull()
      .default('bronze'),
    iconUrl: varchar('icon_url', { length: 255 }),
    pointsRequired: int('points_required').notNull().default(0),
    criteria: json('criteria').$type<{ triggerType: string; triggerValue: Record<string, unknown> } | null>(),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('badges_badge_name_key').on(table.badgeName),
    uniqueIndex('badges_slug_key').on(table.slug),
  ],
);

/**
 * `user_badges` — Badge award records (F7 §06 direct reuse). Composite PK
 * (user_id, badge_id) enforces the idempotency invariant: a badge can be
 * earned at most once per user (invariant 1). `awarded_reason` stores the
 * trigger description captured at award time.
 */
export const userBadges = mysqlTable(
  'user_badges',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    badgeId: int('badge_id')
      .notNull()
      .references(() => badges.badgeId, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at').notNull().defaultNow(),
    awardedReason: text('awarded_reason'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.badgeId] }),
    index('idx_user_badges_user').on(table.userId),
  ],
);

/**
 * `achievements` — Achievement catalog (F7 §06 direct reuse). `points_awarded`
 * is the one-time point reward on unlock; `trigger_type` is a string key
 * (`lab_completions`, `course_completions`, `streak_days`, `points_balance`)
 * and `trigger_value` JSON holds the threshold. `is_active = FALSE` rows are
 * ignored by the evaluation engine.
 */
export const achievements = mysqlTable(
  'achievements',
  {
    achievementId: int('achievement_id').autoincrement().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    pointsAwarded: int('points_awarded').notNull().default(0),
    triggerType: varchar('trigger_type', { length: 50 }),
    triggerValue: json('trigger_value').$type<Record<string, unknown> | null>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('achievements_name_key').on(table.name)],
);

/**
 * `user_achievements` — Achievement unlock records (F7 §06 direct reuse).
 * Composite PK (user_id, achievement_id) enforces the idempotency invariant
 * (invariant 2). `progress_data` JSON snapshots the metrics at unlock time.
 */
export const userAchievements = mysqlTable(
  'user_achievements',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    achievementId: int('achievement_id')
      .notNull()
      .references(() => achievements.achievementId, { onDelete: 'cascade' }),
    unlockedAt: timestamp('unlocked_at').notNull().defaultNow(),
    progressData: json('progress_data').$type<Record<string, unknown> | null>(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.achievementId] })],
);

/**
 * `points_history` — Append-only points ledger (F7 §06 direct reuse).
 * `points_change` is positive (earned) or negative (penalty); the running
 * `points_balance_after` is computed inside a transaction. Rows are NEVER
 * updated or deleted (invariant 3) — corrections are new `admin_adjustment`
 * rows. `source_type` mirrors the SQL ENUM verbatim.
 */
export const pointsHistory = mysqlTable(
  'points_history',
  {
    historyId: int('history_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    pointsChange: int('points_change').notNull(),
    pointsBalanceAfter: int('points_balance_after').notNull(),
    sourceType: mysqlEnum('source_type', [
      'machine_own',
      'challenge_solve',
      'course_complete',
      'achievement',
      'daily_bonus',
      'admin_adjustment',
      'penalty',
    ]).notNull(),
    sourceId: int('source_id'),
    description: text('description'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_ph_user').on(table.userId),
    index('idx_ph_created').on(table.createdAt),
  ],
);

/**
 * `certificates` — Course completion certificates (F7 §06 direct reuse).
 * `certificate_number` is globally unique (`DM-{YYYY}-{UUID8}`); the
 * `unique_user_course` key guarantees one certificate per (user_id, course_id)
 * (invariants 4 & 5). `grade` is computed at issuance only; `certificate_url`
 * is the shareable public verification URL; `verifier_ip` records the last
 * public verification request. `is_valid = FALSE` rows still verify as invalid
 * without exposing the invalidation reason (invariant 12).
 */
export const certificates = mysqlTable(
  'certificates',
  {
    certificateId: int('certificate_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    courseId: int('course_id')
      .notNull()
      .references(() => academyCourses.courseId, { onDelete: 'cascade' }),
    certificateNumber: varchar('certificate_number', { length: 50 }).notNull(),
    grade: decimal('grade', { precision: 5, scale: 2 }),
    certificateUrl: varchar('certificate_url', { length: 255 }),
    issuedAt: timestamp('issued_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    isValid: boolean('is_valid').notNull().default(true),
    verifierIp: varchar('verifier_ip', { length: 45 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('certificates_certificate_number_key').on(table.certificateNumber),
    uniqueIndex('certificates_user_course_key').on(table.userId, table.courseId),
    index('idx_cert_number').on(table.certificateNumber),
  ],
);

/**
 * `leaderboards` — Global / country / region rank snapshot (F7 §06 reuse).
 * Recomputed by the scheduled job every 15 minutes; never real-time.
 * `machine_owns_count` and `challenge_solves_count` are cybersecurity-domain
 * columns permanently held at 0 in DevOps Mentor (invariant 11);
 * `course_completions_count` is the primary course metric.
 */
export const leaderboards = mysqlTable(
  'leaderboards',
  {
    leaderboardId: int('leaderboard_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    totalPoints: int('total_points').notNull().default(0),
    machineOwnsCount: int('machine_owns_count').notNull().default(0),
    challengeSolvesCount: int('challenge_solves_count').notNull().default(0),
    courseCompletionsCount: int('course_completions_count').notNull().default(0),
    globalRank: int('global_rank'),
    countryRank: int('country_rank'),
    regionRank: int('region_rank'),
    calculatedAt: timestamp('calculated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_global_rank').on(table.globalRank),
    index('idx_points').on(table.totalPoints),
  ],
);

/**
 * `leaderboard_history` — Rank trend snapshots (F7 §06 direct reuse). One row
 * per user per computation cycle (AC-10); powers the trend charts. Read-only
 * from the API; written exclusively by the leaderboard computation job.
 */
export const leaderboardHistory = mysqlTable(
  'leaderboard_history',
  {
    historyId: int('history_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    totalPoints: int('total_points').notNull().default(0),
    globalRank: int('global_rank'),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_lh_user').on(table.userId),
    index('idx_lh_recorded').on(table.recordedAt),
  ],
);

/**
 * `seasons` — Time-boxed ranking periods (F7 §06 direct reuse).
 * `season_number` is unique; `start_date`/`end_date` bound the point window
 * used by `season_leaderboards`. `is_active` marks the current period; an
 * overlap between active seasons is rejected at the admin service layer.
 */
export const seasons = mysqlTable(
  'seasons',
  {
    seasonId: int('season_id').autoincrement().primaryKey(),
    seasonName: varchar('season_name', { length: 100 }).notNull(),
    seasonNumber: int('season_number').notNull(),
    description: text('description'),
    bannerUrl: varchar('banner_url', { length: 255 }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('seasons_season_number_key').on(table.seasonNumber),
    index('idx_seasons_dates').on(table.startDate, table.endDate),
  ],
);

/**
 * `season_content` — Content assigned to a season (F7 §06 reuse). The SQL ENUM
 * carries `machine`/`challenge` (cybersecurity-domain, rejected at the Zod
 * layer with 422 per AC-09) and `lab`; in DevOps Mentor only `lab` is an
 * insertable value (the `course` value from the contract has no SQL ENUM slot).
 */
export const seasonContent = mysqlTable(
  'season_content',
  {
    seasonId: int('season_id')
      .notNull()
      .references(() => seasons.seasonId, { onDelete: 'cascade' }),
    contentType: mysqlEnum('content_type', ['machine', 'challenge', 'lab']).notNull(),
    contentId: int('content_id').notNull(),
    releaseOrder: int('release_order').notNull(),
    isReleased: boolean('is_released').notNull().default(false),
    releasedAt: timestamp('released_at'),
  },
  (table) => [primaryKey({ columns: [table.seasonId, table.contentType, table.contentId] })],
);

/**
 * `season_leaderboards` — Per-season point accumulation and rank (F7 §06
 * reuse). `points_earned` aggregates `points_history` within the season date
 * window; `rank` is computed at query time (contract §02). The
 * `unique_season_user` key (season_id, user_id) makes the recompute a UPSERT.
 */
export const seasonLeaderboards = mysqlTable(
  'season_leaderboards',
  {
    leaderboardId: int('leaderboard_id').autoincrement().primaryKey(),
    seasonId: int('season_id')
      .notNull()
      .references(() => seasons.seasonId, { onDelete: 'cascade' }),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    pointsEarned: int('points_earned').notNull().default(0),
    rank: int('rank'),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex('season_leaderboards_season_user_key').on(table.seasonId, table.userId),
  ],
);

export const badgesRelations = relations(badges, ({ many }) => ({
  userBadges: many(userBadges),
}));

export const userBadgesRelations = relations(userBadges, ({ one }) => ({
  user: one(users, { fields: [userBadges.userId], references: [users.userId] }),
  badge: one(badges, { fields: [userBadges.badgeId], references: [badges.badgeId] }),
}));

export const achievementsRelations = relations(achievements, ({ many }) => ({
  userAchievements: many(userAchievements),
}));

export const userAchievementsRelations = relations(userAchievements, ({ one }) => ({
  user: one(users, { fields: [userAchievements.userId], references: [users.userId] }),
  achievement: one(achievements, {
    fields: [userAchievements.achievementId],
    references: [achievements.achievementId],
  }),
}));

export const pointsHistoryRelations = relations(pointsHistory, ({ one }) => ({
  user: one(users, { fields: [pointsHistory.userId], references: [users.userId] }),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
  user: one(users, { fields: [certificates.userId], references: [users.userId] }),
  course: one(academyCourses, {
    fields: [certificates.courseId],
    references: [academyCourses.courseId],
  }),
}));

export const leaderboardsRelations = relations(leaderboards, ({ one }) => ({
  user: one(users, { fields: [leaderboards.userId], references: [users.userId] }),
}));

export const leaderboardHistoryRelations = relations(leaderboardHistory, ({ one }) => ({
  user: one(users, { fields: [leaderboardHistory.userId], references: [users.userId] }),
}));

export const seasonsRelations = relations(seasons, ({ many }) => ({
  content: many(seasonContent),
  leaderboards: many(seasonLeaderboards),
}));

export const seasonContentRelations = relations(seasonContent, ({ one }) => ({
  season: one(seasons, { fields: [seasonContent.seasonId], references: [seasons.seasonId] }),
}));

export const seasonLeaderboardsRelations = relations(seasonLeaderboards, ({ one }) => ({
  season: one(seasons, { fields: [seasonLeaderboards.seasonId], references: [seasons.seasonId] }),
  user: one(users, { fields: [seasonLeaderboards.userId], references: [users.userId] }),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * F8 — Analytics, Notifications & Platform Operations (§06 embedded DB mapping).
 * Tables mirror CREATE TABLE statements in devops_db.sql verbatim; no schema
 * alteration was required. Cybersecurity-domain enum values on reused tables
 * (`machine`, `challenge`, `writeup`, `forum`, ...) are rejected at the Zod
 * validation layer per AC-09/AC-10 and permanently unused in DevOps Mentor.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * `notifications` — In-app notification store (F8 §06 direct reuse). The
 * `type` ENUM mirrors the SQL source verbatim; `is_dismissed` rows are hidden
 * from the inbox but never deleted. Read/dismiss ownership is always enforced
 * as `user_id = session.userId` (AC-14 IDOR mitigation).
 */
export const notifications = mysqlTable(
  'notifications',
  {
    notificationId: int('notification_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    type: mysqlEnum('type', [
      'system',
      'achievement',
      'badge',
      'mention',
      'comment',
      'like',
      'follow',
      'team_invite',
      'ctf',
      'event',
      'security',
    ]).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message'),
    linkUrl: varchar('link_url', { length: 255 }),
    iconUrl: varchar('icon_url', { length: 255 }),
    isRead: boolean('is_read').notNull().default(false),
    isDismissed: boolean('is_dismissed').notNull().default(false),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_read').on(table.userId, table.isRead),
    index('idx_created').on(table.createdAt),
  ],
);

/**
 * `notification_preferences` — Per-user, per-type channel toggles (F8 §06
 * direct reuse). Composite PK (user_id, type). `NotificationService.dispatch`
 * reads this table before every INSERT/email dispatch (invariant 1).
 */
export const notificationPreferences = mysqlTable(
  'notification_preferences',
  {
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.userId, table.type] })],
);

/**
 * `announcements` — Platform announcement publishing (F8 §06 direct reuse).
 * `priority` drives banner styling; expired rows (`expires_at < NOW()`) are
 * excluded from every learner-facing list (AC-13). `is_published = FALSE`
 * rows are draft state visible only to platform admins.
 */
export const announcements = mysqlTable(
  'announcements',
  {
    announcementId: int('announcement_id').autoincrement().primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    content: longtext('content').notNull(),
    announcementType: mysqlEnum('announcement_type', [
      'general',
      'maintenance',
      'feature',
      'security',
      'event',
    ]).notNull(),
    priority: mysqlEnum('priority', ['low', 'medium', 'high', 'critical'])
      .notNull()
      .default('medium'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at'),
    expiresAt: timestamp('expires_at'),
    createdBy: int('created_by')
      .notNull()
      .references(() => users.userId),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_published').on(table.isPublished, table.publishedAt),
    index('idx_expires').on(table.expiresAt),
  ],
);

/**
 * `announcement_reads` — Per-user announcement read tracking (F8 §06 direct
 * reuse). Composite PK (announcement_id, user_id) makes mark-read idempotent.
 */
export const announcementReads = mysqlTable(
  'announcement_reads',
  {
    announcementId: int('announcement_id')
      .notNull()
      .references(() => announcements.announcementId, { onDelete: 'cascade' }),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    readAt: timestamp('read_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.userId] })],
);

/**
 * `events` — Webinar/workshop/competition catalog (F8 §06 direct reuse).
 * `max_attendees = 0` means unlimited capacity; `is_active = FALSE` hides the
 * event from public browse lists.
 */
export const events = mysqlTable(
  'events',
  {
    eventId: int('event_id').autoincrement().primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    location: varchar('location', { length: 255 }),
    eventType: mysqlEnum('event_type', [
      'webinar',
      'workshop',
      'competition',
      'conference',
      'meetup',
    ]).notNull(),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    timezone: varchar('timezone', { length: 50 }),
    maxAttendees: int('max_attendees').notNull().default(0),
    isFree: boolean('is_free').notNull().default(true),
    price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0'),
    registrationDeadline: timestamp('registration_deadline'),
    bannerUrl: varchar('banner_url', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: int('created_by')
      .notNull()
      .references(() => users.userId),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_dates').on(table.startTime, table.endTime)],
);

/**
 * `event_registrations` — Event attendee records (F8 §06 direct reuse).
 * The SQL `unique_event_user` key makes duplicate registration impossible;
 * the service pre-checks it and returns 409 (AC-05). At capacity the row is
 * inserted with `status = 'waitlisted'` instead of `'registered'`.
 */
export const eventRegistrations = mysqlTable(
  'event_registrations',
  {
    registrationId: int('registration_id').autoincrement().primaryKey(),
    eventId: int('event_id')
      .notNull()
      .references(() => events.eventId, { onDelete: 'cascade' }),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    attendeeName: varchar('attendee_name', { length: 100 }),
    attendeeEmail: varchar('attendee_email', { length: 255 }),
    company: varchar('company', { length: 100 }),
    dietaryRestrictions: text('dietary_restrictions'),
    specialRequirements: text('special_requirements'),
    status: mysqlEnum('status', [
      'registered',
      'attended',
      'cancelled',
      'waitlisted',
    ])
      .notNull()
      .default('registered'),
    registeredAt: timestamp('registered_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_registrations_event_user_key').on(table.eventId, table.userId),
  ],
);

/**
 * `reviews` — Course and lab star ratings (F8 §06 adapted reuse). The SQL ENUM
 * carries cybersecurity-domain values (`machine`, `challenge`, `writeup`);
 * the Zod layer restricts `target_type` to `('course', 'lab')` in DevOps
 * Mentor (invariant 2). The table has NO unique key on (user, target), so the
 * duplicate-review check is an application-level SELECT COUNT before INSERT
 * returning 409 (AC-02).
 */
export const reviews = mysqlTable(
  'reviews',
  {
    reviewId: int('review_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    targetType: mysqlEnum('target_type', [
      'machine',
      'challenge',
      'course',
      'lab',
      'writeup',
    ]).notNull(),
    targetId: int('target_id').notNull(),
    rating: int('rating'),
    title: varchar('title', { length: 255 }),
    content: text('content'),
    isApproved: boolean('is_approved').notNull().default(false),
    helpfulCount: int('helpful_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [index('idx_target').on(table.targetType, table.targetId)],
);

/**
 * `comments` — Threaded comments (F8 §06 adapted reuse). The SQL ENUM carries
 * `forum`/`machine`/`challenge`/`writeup`; the Zod layer restricts
 * `target_type` to `('course', 'lab', 'news')` (AC-10). `is_hidden = TRUE`
 * rows are excluded from every non-admin list (AC-11); `parent_comment_id`
 * validates against the same (target_type, target_id) pair server-side.
 */
export const comments = mysqlTable(
  'comments',
  {
    commentId: int('comment_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    parentCommentId: int('parent_comment_id').references(
      (): AnyMySqlColumn => comments.commentId,
      { onDelete: 'cascade' },
    ),
    targetType: mysqlEnum('target_type', [
      'machine',
      'challenge',
      'writeup',
      'forum',
      'course',
      'lab',
      'news',
    ]).notNull(),
    targetId: int('target_id').notNull(),
    content: text('content').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    likesCount: int('likes_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_target').on(table.targetType, table.targetId),
    index('idx_parent').on(table.parentCommentId),
  ],
);

/**
 * `likes` — Reactions on comments and reviews (F8 §06 adapted reuse). The SQL
 * `unique_user_target` key enforces one like per (user, target); a duplicate
 * attempt returns 409 and DELETE removes the row (invariant 6). `like_type`
 * mirrors the SQL ENUM verbatim.
 */
export const likes = mysqlTable(
  'likes',
  {
    likeId: int('like_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    targetType: mysqlEnum('target_type', [
      'comment',
      'review',
      'writeup',
      'forum_post',
      'solution',
      'machine',
    ]).notNull(),
    targetId: int('target_id').notNull(),
    likeType: mysqlEnum('like_type', ['like', 'love', 'useful', 'funny'])
      .notNull()
      .default('like'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('likes_unique_user_target').on(table.userId, table.targetType, table.targetId)],
);

/**
 * `reports` — Content moderation queue (F8 §06 adapted reuse). The SQL ENUM
 * carries `machine`/`writeup`/`challenge`; the Zod layer restricts
 * `target_type` to `('user', 'comment', 'review', 'course', 'lab')` (AC-09).
 * `status` follows the state machine pending → reviewing → resolved/dismissed.
 * The report queue is readable only by `platform.content.moderate` holders.
 */
export const reports = mysqlTable(
  'reports',
  {
    reportId: int('report_id').autoincrement().primaryKey(),
    reporterUserId: int('reporter_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    reportedUserId: int('reported_user_id').references(() => users.userId, {
      onDelete: 'cascade',
    }),
    targetType: mysqlEnum('target_type', [
      'user',
      'comment',
      'review',
      'machine',
      'writeup',
      'challenge',
      'course',
    ]).notNull(),
    targetId: int('target_id').notNull(),
    reportReason: varchar('report_reason', { length: 100 }).notNull(),
    description: text('description'),
    status: mysqlEnum('status', ['pending', 'reviewing', 'resolved', 'dismissed'])
      .notNull()
      .default('pending'),
    resolvedBy: int('resolved_by').references(() => users.userId, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    index('idx_status').on(table.status),
    index('idx_target').on(table.targetType, table.targetId),
  ],
);

/**
 * `email_templates` — Transactional email template store (F8 §06 direct
 * reuse). `placeholders` JSON lists the substitution keys (e.g.
 * `["{{userName}}","{{otpCode}}"]`). Templates with `is_active = FALSE` are
 * silently skipped by the dispatch adapter (invariant 13).
 */
export const emailTemplates = mysqlTable(
  'email_templates',
  {
    templateId: int('template_id').autoincrement().primaryKey(),
    templateKey: varchar('template_key', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    bodyHtml: longtext('body_html').notNull(),
    bodyText: text('body_text'),
    placeholders: json('placeholders').$type<string[] | null>(),
    isActive: boolean('is_active').notNull().default(true),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('email_templates_template_key_key').on(table.templateKey)],
);

/**
 * `media` — Media metadata attached to `files` rows (F8 §06 direct reuse).
 * One `files` row may carry at most one media extension row; the FK cascade
 * deletes the media row when the file is removed.
 */
export const media = mysqlTable(
  'media',
  {
    mediaId: int('media_id').autoincrement().primaryKey(),
    fileId: int('file_id')
      .notNull()
      .references(() => files.fileId, { onDelete: 'cascade' }),
    altText: varchar('alt_text', { length: 255 }),
    width: int('width'),
    height: int('height'),
    durationSeconds: int('duration_seconds'),
    thumbnailUrl: varchar('thumbnail_url', { length: 255 }),
  },
  (table) => [index('idx_media_file').on(table.fileId)],
);

/**
 * `downloads` — File download tracking (F8 §06 direct reuse). Every download
 * by an authenticated user INSERTs a row; `files.downloads_count` is
 * incremented atomically in the same operation (invariant 12).
 */
export const downloads = mysqlTable(
  'downloads',
  {
    downloadId: int('download_id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    fileId: int('file_id')
      .notNull()
      .references(() => files.fileId, { onDelete: 'cascade' }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    downloadedAt: timestamp('downloaded_at').notNull().defaultNow(),
  },
  (table) => [index('idx_user_file').on(table.userId, table.fileId)],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.userId] }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.userId] }),
}));

export const announcementsRelations = relations(announcements, ({ one, many }) => ({
  creator: one(users, { fields: [announcements.createdBy], references: [users.userId] }),
  reads: many(announcementReads),
}));

export const announcementReadsRelations = relations(announcementReads, ({ one }) => ({
  announcement: one(announcements, {
    fields: [announcementReads.announcementId],
    references: [announcements.announcementId],
  }),
  user: one(users, { fields: [announcementReads.userId], references: [users.userId] }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  creator: one(users, { fields: [events.createdBy], references: [users.userId] }),
  registrations: many(eventRegistrations),
}));

export const eventRegistrationsRelations = relations(eventRegistrations, ({ one }) => ({
  event: one(events, { fields: [eventRegistrations.eventId], references: [events.eventId] }),
  user: one(users, { fields: [eventRegistrations.userId], references: [users.userId] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  user: one(users, { fields: [reviews.userId], references: [users.userId] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  user: one(users, { fields: [comments.userId], references: [users.userId] }),
  parent: one(comments, {
    fields: [comments.parentCommentId],
    references: [comments.commentId],
    relationName: 'comment_parent',
  }),
  replies: many(comments, { relationName: 'comment_parent' }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.userId] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterUserId], references: [users.userId] }),
  reportedUser: one(users, { fields: [reports.reportedUserId], references: [users.userId] }),
  resolver: one(users, { fields: [reports.resolvedBy], references: [users.userId] }),
}));

export const emailTemplatesRelations = relations(emailTemplates, () => ({}));

export const mediaRelations = relations(media, ({ one }) => ({
  file: one(files, { fields: [media.fileId], references: [files.fileId] }),
}));

export const downloadsRelations = relations(downloads, ({ one }) => ({
  user: one(users, { fields: [downloads.userId], references: [users.userId] }),
  file: one(files, { fields: [downloads.fileId], references: [files.fileId] }),
}));
