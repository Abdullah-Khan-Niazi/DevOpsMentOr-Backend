export { HTTP_STATUS, type HttpStatusCode } from './http-status';
export { UserStatus, getUserStatus } from './enums';

export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  ROLES_READ: 'roles:read',
  ROLES_CREATE: 'roles:create',
  ROLES_UPDATE: 'roles:update',
  ROLES_DELETE: 'roles:delete',
  PERMISSIONS_READ: 'permissions:read',
  PERMISSIONS_MANAGE: 'permissions:manage',
  REPORTS_READ: 'reports:read',
  DASHBOARD_READ: 'dashboard:read',
  // ─── F1 Identity / Auth / Authorization ─────────────────────────────────
  PLATFORM_ADMIN_ACCESS: 'platform.admin.access',
  PLATFORM_ADMIN_INVITE: 'platform.admin.invite',
  PLATFORM_USERS_READ: 'platform.users.read',
  AUTH_SESSION_READ: 'auth:session:read',
  AUTH_SESSION_DELETE: 'auth:session:delete',
  AUTH_APITOKEN_CREATE: 'auth:apitoken:create',
  AUTH_APITOKEN_READ: 'auth:apitoken:read',
  AUTH_APITOKEN_DELETE: 'auth:apitoken:delete',
  AUTH_LOGIN_HISTORY_READ: 'auth:loginhistory:read',
} as const;

export const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  ORG_ADMIN: 'org_admin',
  PROFESSOR: 'professor',
  ORG_STUDENT: 'org_student',
  INDIVIDUAL_LEARNER: 'individual_learner',
  GUEST: 'guest',
  /** Legacy alias for the default learner role assigned at registration. */
  USER: 'individual_learner',
} as const;