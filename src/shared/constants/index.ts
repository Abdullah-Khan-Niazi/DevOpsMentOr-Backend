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
  // ─── F2 Users / Profiles / Platform Administration ──────────────────────
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  USERS_PROFILE_READ: 'users:profile:read',
  USERS_PROFILE_UPDATE: 'users:profile:update',
  USERS_SKILLS_MANAGE: 'users:skills:manage',
  USERS_FOLLOW_MANAGE: 'users:follow:manage',
  // ─── F3 Organizations / Classes / Academic Enrollment ───────────────────
  PLATFORM_ORGANIZATIONS_MANAGE: 'platform.organizations.manage',
  PLATFORM_ORGANIZATIONS_READ: 'platform.organizations.read',
  ORG_READ: 'org:read',
  ORG_MANAGE: 'org:manage',
  ORG_CLASSES_MANAGE: 'org:classes:manage',
  ORG_PROFESSORS_INVITE: 'org:professors:invite',
  ORG_STUDENTS_INVITE: 'org:students:invite',
  CLASS_MANAGE: 'class:manage',
  CLASS_STUDENTS_READ: 'class:students:read',
  CLASS_STUDENTS_INVITE: 'class:students:invite',
  ENROLLMENT_READ: 'enrollment:read',
  // ─── F4 Canonical Curriculum / Course Content ─────────────────────────
  CURRICULUM_READ: 'curriculum.read',
  PLATFORM_CURRICULUM_READ: 'platform.curriculum.read',
  PLATFORM_CURRICULUM_MANAGE: 'platform.curriculum.manage',
  // ─── F5 Learning Experience / Progress Tracking (§04 permission values) ─
  PROGRESS_SELF_READ: 'progress.self.read',
  PROGRESS_SELF_WRITE: 'progress.self.write',
  PROGRESS_CLASS_READ: 'progress.class.read',
  PROGRESS_ORG_READ: 'progress.org.read',
  PLATFORM_PROGRESS_READ: 'platform.progress.read',
  // ─── F6 Labs / Execution Engine / AI Mentor (§04 permission values) ───────
  LABS_INSTANCE_CREATE: 'labs:instance:create',
  LABS_INSTANCE_READ: 'labs:instance:read',
  LABS_INSTANCE_DELETE: 'labs:instance:delete',
  LABS_AI_MENTOR_USE: 'labs:ai-mentor:use',
  LABS_CLASS_READ: 'labs:class:read',
  LABS_ORG_READ: 'labs:org:read',
  PLATFORM_LABS_MANAGE: 'platform.labs.manage',
  PLATFORM_LABS_ADMIN: 'platform.labs.admin',
  // ─── F7 Achievements / Gamification / Certification (§04 permission values) ─
  GAMIFICATION_PROFILE_READ: 'gamification:profile:read',
  GAMIFICATION_CERTIFICATE_DOWNLOAD: 'gamification:certificate:download',
  GAMIFICATION_CLASS_READ: 'gamification:class:read',
  GAMIFICATION_ORG_READ: 'gamification:org:read',
  PLATFORM_GAMIFICATION_MANAGE: 'platform.gamification.manage',
  // ─── F8 Analytics / Notifications / Platform Operations (§04 permission values) ─
  NOTIFICATIONS_INBOX_READ: 'notifications:inbox:read',
  NOTIFICATIONS_PREFERENCES_WRITE: 'notifications:preferences:write',
  CONTENT_REVIEW_CREATE: 'content:review:create',
  CONTENT_COMMENT_CREATE: 'content:comment:create',
  CONTENT_LIKE_CREATE: 'content:like:create',
  CONTENT_REPORT_CREATE: 'content:report:create',
  EVENTS_REGISTER: 'events:register',
  PLATFORM_CONTENT_MODERATE: 'platform.content.moderate',
  PLATFORM_ANALYTICS_READ: 'platform.analytics.read',
  // ─── F9 Subscription, Billing & Entitlements (§04 permission values) ───────
  BILLING_SUBSCRIPTION_CREATE: 'billing:subscription:create',
  BILLING_SUBSCRIPTION_READ: 'billing:subscription:read',
  BILLING_SUBSCRIPTION_CANCEL: 'billing:subscription:cancel',
  BILLING_PAYMENT_METHOD_MANAGE: 'billing:paymentmethod:manage',
  BILLING_ORDER_READ: 'billing:order:read',
  BILLING_INVOICE_READ: 'billing:invoice:read',
  BILLING_ORG_MANAGE: 'billing:org:manage',
  PLATFORM_BILLING_MANAGE: 'platform.billing.manage',
} as const;

/** Audit log action strings (F2 §07 contract values). */
export const AUDIT_ACTIONS = {
  BAN_USER: 'ban_user',
  UNBAN_USER: 'unban_user',
  DELETE_USER: 'delete_user',
  UPDATE_SETTING: 'update_setting',
  // ─── F3 org / class admin mutations ─────────────────────────────────────
  CREATE_ORG: 'create_org',
  UPDATE_ORG: 'update_org',
  ASSIGN_ORG_ADMIN: 'assign_org_admin',
  CREATE_CLASS: 'create_class',
  UPDATE_CLASS: 'update_class',
  ASSIGN_PROFESSOR: 'assign_professor',
  INVITE_PROFESSOR: 'invite_professor',
  INVITE_STUDENTS: 'invite_students',
  WITHDRAW_STUDENT: 'withdraw_student',
  SET_EMAIL_DOMAIN: 'set_email_domain',
  // ─── F4 curriculum admin mutations ──────────────────────────────────────
  UPDATE_COURSE: 'update_course',
  CREATE_MODULE: 'create_module',
  UPDATE_MODULE: 'update_module',
  PUBLISH_MODULE: 'publish_module',
  ARCHIVE_MODULE: 'archive_module',
  REORDER_MODULES: 'reorder_modules',
  CREATE_LESSON: 'create_lesson',
  UPDATE_LESSON: 'update_lesson',
  PUBLISH_LESSON: 'publish_lesson',
  REORDER_LESSONS: 'reorder_lessons',
  CREATE_QUIZ: 'create_quiz',
  UPDATE_QUIZ: 'update_quiz',
  CREATE_QUESTION: 'create_question',
  UPDATE_QUESTION: 'update_question',
  // ─── F6 labs admin mutations (§07 traceability) ───────────────────────────
  CREATE_LAB: 'create_lab',
  UPDATE_LAB: 'update_lab',
  PUBLISH_LAB: 'publish_lab',
  CREATE_TRACK: 'create_track',
  UPDATE_TRACK: 'update_track',
  TERMINATE_INSTANCE: 'terminate_instance',
  // ─── F8 platform operations admin mutations (§07 traceability) ────────────
  CREATE_ANNOUNCEMENT: 'create_announcement',
  UPDATE_ANNOUNCEMENT: 'update_announcement',
  PUBLISH_ANNOUNCEMENT: 'publish_announcement',
  CREATE_EVENT: 'create_event',
  UPDATE_EVENT: 'update_event',
  APPROVE_REVIEW: 'approve_review',
  DELETE_REVIEW: 'delete_review',
  PIN_COMMENT: 'pin_comment',
  HIDE_COMMENT: 'hide_comment',
  RESOLVE_REPORT: 'resolve_report',
  DISMISS_REPORT: 'dismiss_report',
  UPDATE_EMAIL_TEMPLATE: 'update_email_template',
  UPLOAD_FILE: 'upload_file',
  // ─── F9 billing admin mutations (§07 traceability) ────────────────────────
  FLAG_REFUND: 'flag_refund',
  ADJUST_SUBSCRIPTION: 'adjust_subscription',
  CREATE_COUPON: 'create_coupon',
  UPDATE_COUPON: 'update_coupon',
} as const;

/**
 * F3 org-domain constants (§06 adaptation mapping).
 * `ORG_ID_SETTING_KEY` stores a user's single organization affiliation in
 * `user_settings`; `ORG_EMAIL_DOMAIN_KEY` stores the per-org email domain
 * restriction in `system_settings`; `ORG_INVITE_SENTINEL_SLUG` identifies the
 * global sentinel team that anchors org-level professor invitations.
 */
export const ORG_CONSTANTS = {
  ORG_ID_SETTING_KEY: 'org_id',
  ORG_EMAIL_DOMAIN_KEY: (orgId: number): string => `org:${orgId}:email_domain`,
  ORG_INVITE_SENTINEL_SLUG: '__org_invites__',
  INVITE_TTL_HOURS: 72,
  INVITE_TTL_SECONDS: 72 * 60 * 60,
  IMPORT_ROW_LIMIT: 200,
  IMPORT_FILE_SIZE_LIMIT: 1024 * 1024,
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