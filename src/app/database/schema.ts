import { relations } from 'drizzle-orm';
import {
  boolean,
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

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  sessions: many(sessions),
  otpCodes: many(otpCodes),
  loginHistory: many(loginHistory),
  apiTokens: many(apiTokens),
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