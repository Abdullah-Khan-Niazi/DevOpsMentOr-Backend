import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import {
  academyCourses,
  categories,
  countries,
  db,
  difficultyLevels,
  disconnectDatabase,
  emailTemplates,
  organizations,
  permissions,
  rolePermissions,
  roles,
  skills,
  systemSettings,
  tags,
  teamInvitations,
  teamMembers,
  teams,
  userProfiles,
  userRoles,
  userSettings,
  userSkills,
  users,
} from '../src/app/database';
import { PERMISSIONS, ORG_CONSTANTS, ROLES } from '../src/shared/constants';
import { env } from '../src/app/config';

dotenv.config();

/**
 * Seed: F1 role/permission matrix + bootstrap platform admin.
 *
 * Role and permission names are the F1 contract values. The platform admin
 * account is created from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (env-driven;
 * never hardcoded). Idempotent: safe to re-run.
 */

type PermissionDefinition = { name: string; module: string; description: string };

const permissionDefinitions: PermissionDefinition[] = [
  { name: PERMISSIONS.USERS_READ, module: 'platform', description: 'Read user records' },
  { name: PERMISSIONS.USERS_CREATE, module: 'platform', description: 'Create user records' },
  { name: PERMISSIONS.USERS_UPDATE, module: 'platform', description: 'Update user records' },
  { name: PERMISSIONS.USERS_DELETE, module: 'platform', description: 'Delete user records' },
  { name: PERMISSIONS.ROLES_READ, module: 'platform', description: 'Read role definitions' },
  { name: PERMISSIONS.ROLES_CREATE, module: 'platform', description: 'Create role definitions' },
  { name: PERMISSIONS.ROLES_UPDATE, module: 'platform', description: 'Update role definitions' },
  { name: PERMISSIONS.ROLES_DELETE, module: 'platform', description: 'Delete role definitions' },
  { name: PERMISSIONS.PERMISSIONS_READ, module: 'platform', description: 'Read permission definitions' },
  { name: PERMISSIONS.PERMISSIONS_MANAGE, module: 'platform', description: 'Manage permission definitions' },
  { name: PERMISSIONS.REPORTS_READ, module: 'platform', description: 'Read platform reports' },
  { name: PERMISSIONS.DASHBOARD_READ, module: 'platform', description: 'Read dashboard stats' },
  // ─── F1 Identity / Auth / Authorization ────────────────────────────────────
  { name: PERMISSIONS.PLATFORM_ADMIN_ACCESS, module: 'auth', description: 'Authenticate at the admin login surface' },
  { name: PERMISSIONS.PLATFORM_ADMIN_INVITE, module: 'auth', description: 'Send or revoke platform admin invitations' },
  { name: PERMISSIONS.PLATFORM_USERS_READ, module: 'auth', description: 'Read platform admin user records' },
  { name: PERMISSIONS.AUTH_SESSION_READ, module: 'auth', description: 'Read own session records' },
  { name: PERMISSIONS.AUTH_SESSION_DELETE, module: 'auth', description: 'Delete own session (logout)' },
  { name: PERMISSIONS.AUTH_APITOKEN_CREATE, module: 'auth', description: 'Create personal API tokens' },
  { name: PERMISSIONS.AUTH_APITOKEN_READ, module: 'auth', description: 'List own API tokens' },
  { name: PERMISSIONS.AUTH_APITOKEN_DELETE, module: 'auth', description: 'Revoke own API tokens' },
  { name: PERMISSIONS.AUTH_LOGIN_HISTORY_READ, module: 'auth', description: 'Read own login history' },
  // ─── F2 Users / Profiles / Platform Administration ──────────────────────
  { name: PERMISSIONS.PLATFORM_USERS_MANAGE, module: 'platform', description: 'Manage platform users (ban, unban, soft delete)' },
  { name: PERMISSIONS.PLATFORM_SETTINGS_MANAGE, module: 'platform', description: 'Manage platform system settings' },
  { name: PERMISSIONS.USERS_PROFILE_READ, module: 'users', description: 'Read own user profile' },
  { name: PERMISSIONS.USERS_PROFILE_UPDATE, module: 'users', description: 'Update own user profile' },
  { name: PERMISSIONS.USERS_SKILLS_MANAGE, module: 'users', description: 'Manage own skill list' },
  { name: PERMISSIONS.USERS_FOLLOW_MANAGE, module: 'users', description: 'Follow and unfollow users' },
  // ─── F3 Organizations / Classes / Academic Enrollment ────────────────────
  { name: PERMISSIONS.PLATFORM_ORGANIZATIONS_MANAGE, module: 'organizations', description: 'Create and manage all organizations platform-wide' },
  { name: PERMISSIONS.PLATFORM_ORGANIZATIONS_READ, module: 'organizations', description: 'Read organization records platform-wide' },
  { name: PERMISSIONS.ORG_READ, module: 'organizations', description: 'Read own organization' },
  { name: PERMISSIONS.ORG_MANAGE, module: 'organizations', description: 'Manage own organization' },
  { name: PERMISSIONS.ORG_CLASSES_MANAGE, module: 'organizations', description: 'Create and manage classes in own organization' },
  { name: PERMISSIONS.ORG_PROFESSORS_INVITE, module: 'organizations', description: 'Invite professors to own organization' },
  { name: PERMISSIONS.ORG_STUDENTS_INVITE, module: 'organizations', description: 'Invite students to own organization' },
  { name: PERMISSIONS.CLASS_MANAGE, module: 'organizations', description: 'Manage a class (update, assign professor)' },
  { name: PERMISSIONS.CLASS_STUDENTS_READ, module: 'organizations', description: 'Read class roster and invitations' },
  { name: PERMISSIONS.CLASS_STUDENTS_INVITE, module: 'organizations', description: 'Invite, import and withdraw students' },
  { name: PERMISSIONS.ENROLLMENT_READ, module: 'organizations', description: 'Read own enrollment and accept invitations' },
  // ─── F4 Canonical Curriculum / Course Content ────────────────────────────
  { name: PERMISSIONS.CURRICULUM_READ, module: 'curriculum', description: 'Browse published course, modules, lessons and quiz metadata' },
  { name: PERMISSIONS.PLATFORM_CURRICULUM_READ, module: 'curriculum', description: 'Read all curriculum content including drafts' },
  { name: PERMISSIONS.PLATFORM_CURRICULUM_MANAGE, module: 'curriculum', description: 'Create, edit, publish, archive and reorder curriculum content' },
  // ─── F5 Learning Experience / Progress Tracking ─────────────────────────
  { name: PERMISSIONS.PROGRESS_SELF_READ, module: 'progress', description: 'Read own lesson, module and course progress' },
  { name: PERMISSIONS.PROGRESS_SELF_WRITE, module: 'progress', description: 'Start or complete own lessons and submit quiz attempts' },
  { name: PERMISSIONS.PROGRESS_CLASS_READ, module: 'progress', description: 'Read progress of students in assigned classes' },
  { name: PERMISSIONS.PROGRESS_ORG_READ, module: 'progress', description: 'Read progress of all students in own organization' },
  { name: PERMISSIONS.PLATFORM_PROGRESS_READ, module: 'progress', description: 'Read any user progress platform-wide' },
  // ─── F6 Labs, Execution Engine & AI Mentor ─────────────────────────────
  { name: PERMISSIONS.LABS_INSTANCE_CREATE, module: 'labs', description: 'Provision, start and extend own lab instances' },
  { name: PERMISSIONS.LABS_INSTANCE_READ, module: 'labs', description: 'Read own lab instances, run checks and submit answers' },
  { name: PERMISSIONS.LABS_INSTANCE_DELETE, module: 'labs', description: 'Stop or terminate own lab instances' },
  { name: PERMISSIONS.LABS_AI_MENTOR_USE, module: 'labs', description: 'Use the AI Mentor assistant in lessons and labs' },
  { name: PERMISSIONS.LABS_CLASS_READ, module: 'labs', description: 'Read lab activity of students in assigned classes' },
  { name: PERMISSIONS.LABS_ORG_READ, module: 'labs', description: 'Read lab activity of all students in own organization' },
  { name: PERMISSIONS.PLATFORM_LABS_MANAGE, module: 'labs', description: 'Create, edit and publish labs and tracks' },
  { name: PERMISSIONS.PLATFORM_LABS_ADMIN, module: 'labs', description: 'Monitor and force-terminate any lab instance' },
  // ─── F7 Achievements / Gamification / Certification ─────────────────────
  { name: PERMISSIONS.GAMIFICATION_PROFILE_READ, module: 'gamification', description: 'Read own gamification profile, badges, achievements and points history' },
  { name: PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD, module: 'gamification', description: 'Download own certificates' },
  { name: PERMISSIONS.GAMIFICATION_CLASS_READ, module: 'gamification', description: 'Read leaderboards of assigned classes' },
  { name: PERMISSIONS.GAMIFICATION_ORG_READ, module: 'gamification', description: 'Read leaderboards of own organization' },
  { name: PERMISSIONS.PLATFORM_GAMIFICATION_MANAGE, module: 'gamification', description: 'Manage badges, achievements, seasons, points adjustments and certificate invalidation' },
  // ─── F8 Analytics / Notifications / Platform Operations ──────────────────
  { name: PERMISSIONS.NOTIFICATIONS_INBOX_READ, module: 'notifications', description: 'Read and manage own notification inbox' },
  { name: PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE, module: 'notifications', description: 'Update own notification channel preferences' },
  { name: PERMISSIONS.CONTENT_REVIEW_CREATE, module: 'community', description: 'Submit course and lab reviews' },
  { name: PERMISSIONS.CONTENT_COMMENT_CREATE, module: 'community', description: 'Post comments and replies on courses, lessons and labs' },
  { name: PERMISSIONS.CONTENT_LIKE_CREATE, module: 'community', description: 'React with likes on comments and reviews' },
  { name: PERMISSIONS.CONTENT_REPORT_CREATE, module: 'community', description: 'Submit content moderation reports' },
  { name: PERMISSIONS.EVENTS_REGISTER, module: 'operations', description: 'Register for and cancel platform events' },
  { name: PERMISSIONS.PLATFORM_CONTENT_MODERATE, module: 'community', description: 'Approve reviews, pin or hide comments, resolve and dismiss reports' },
  { name: PERMISSIONS.PLATFORM_ANALYTICS_READ, module: 'analytics', description: 'Read the platform analytics dashboard (aggregated metrics only)' },
  // ─── F9 Subscription / Billing / Entitlements ────────────────────────────
  { name: PERMISSIONS.BILLING_SUBSCRIPTION_CREATE, module: 'billing', description: 'Create and subscribe to plans' },
  { name: PERMISSIONS.BILLING_SUBSCRIPTION_READ, module: 'billing', description: 'Read own subscription status' },
  { name: PERMISSIONS.BILLING_SUBSCRIPTION_CANCEL, module: 'billing', description: 'Cancel own subscription' },
  { name: PERMISSIONS.BILLING_PAYMENT_METHOD_MANAGE, module: 'billing', description: 'Manage saved payment methods' },
  { name: PERMISSIONS.BILLING_ORDER_READ, module: 'billing', description: 'Read own orders and checkout sessions' },
  { name: PERMISSIONS.BILLING_INVOICE_READ, module: 'billing', description: 'Read and download own invoices' },
  { name: PERMISSIONS.BILLING_ORG_MANAGE, module: 'billing', description: 'Manage organization subscription and seats' },
  { name: PERMISSIONS.PLATFORM_BILLING_MANAGE, module: 'billing', description: 'Manage platform billing, subscriptions and coupons' },
];

const rolePermissionMatrix: Record<string, string[]> = {
  [ROLES.PLATFORM_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ORG_ADMIN]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
    PERMISSIONS.USERS_PROFILE_READ,
    PERMISSIONS.USERS_PROFILE_UPDATE,
    PERMISSIONS.USERS_SKILLS_MANAGE,
    PERMISSIONS.USERS_FOLLOW_MANAGE,
    PERMISSIONS.PLATFORM_ORGANIZATIONS_READ,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.ORG_CLASSES_MANAGE,
    PERMISSIONS.ORG_PROFESSORS_INVITE,
    PERMISSIONS.ORG_STUDENTS_INVITE,
    PERMISSIONS.CLASS_MANAGE,
    PERMISSIONS.CLASS_STUDENTS_READ,
    PERMISSIONS.CLASS_STUDENTS_INVITE,
    PERMISSIONS.ENROLLMENT_READ,
    PERMISSIONS.CURRICULUM_READ,
    PERMISSIONS.PROGRESS_SELF_READ,
    PERMISSIONS.PROGRESS_SELF_WRITE,
    PERMISSIONS.PROGRESS_CLASS_READ,
    PERMISSIONS.PROGRESS_ORG_READ,
    PERMISSIONS.LABS_INSTANCE_CREATE,
    PERMISSIONS.LABS_INSTANCE_READ,
    PERMISSIONS.LABS_INSTANCE_DELETE,
    PERMISSIONS.LABS_AI_MENTOR_USE,
    PERMISSIONS.LABS_CLASS_READ,
    PERMISSIONS.LABS_ORG_READ,
    PERMISSIONS.GAMIFICATION_PROFILE_READ,
    PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD,
    PERMISSIONS.GAMIFICATION_ORG_READ,
    PERMISSIONS.NOTIFICATIONS_INBOX_READ,
    PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE,
    PERMISSIONS.CONTENT_REVIEW_CREATE,
    PERMISSIONS.CONTENT_COMMENT_CREATE,
    PERMISSIONS.CONTENT_LIKE_CREATE,
    PERMISSIONS.CONTENT_REPORT_CREATE,
    PERMISSIONS.EVENTS_REGISTER,
    PERMISSIONS.BILLING_SUBSCRIPTION_READ,
    PERMISSIONS.BILLING_PAYMENT_METHOD_MANAGE,
    PERMISSIONS.BILLING_ORDER_READ,
    PERMISSIONS.BILLING_INVOICE_READ,
    PERMISSIONS.BILLING_ORG_MANAGE,
  ],
  [ROLES.PROFESSOR]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
    PERMISSIONS.USERS_PROFILE_READ,
    PERMISSIONS.USERS_PROFILE_UPDATE,
    PERMISSIONS.USERS_SKILLS_MANAGE,
    PERMISSIONS.USERS_FOLLOW_MANAGE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.CLASS_MANAGE,
    PERMISSIONS.CLASS_STUDENTS_READ,
    PERMISSIONS.CLASS_STUDENTS_INVITE,
    PERMISSIONS.ENROLLMENT_READ,
    PERMISSIONS.CURRICULUM_READ,
    PERMISSIONS.PROGRESS_SELF_READ,
    PERMISSIONS.PROGRESS_SELF_WRITE,
    PERMISSIONS.PROGRESS_CLASS_READ,
    PERMISSIONS.LABS_INSTANCE_CREATE,
    PERMISSIONS.LABS_INSTANCE_READ,
    PERMISSIONS.LABS_INSTANCE_DELETE,
    PERMISSIONS.LABS_AI_MENTOR_USE,
    PERMISSIONS.LABS_CLASS_READ,
    PERMISSIONS.GAMIFICATION_PROFILE_READ,
    PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD,
    PERMISSIONS.GAMIFICATION_CLASS_READ,
    PERMISSIONS.NOTIFICATIONS_INBOX_READ,
    PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE,
    PERMISSIONS.CONTENT_REVIEW_CREATE,
    PERMISSIONS.CONTENT_COMMENT_CREATE,
    PERMISSIONS.CONTENT_LIKE_CREATE,
    PERMISSIONS.CONTENT_REPORT_CREATE,
    PERMISSIONS.EVENTS_REGISTER,
  ],
  [ROLES.ORG_STUDENT]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
    PERMISSIONS.USERS_PROFILE_READ,
    PERMISSIONS.USERS_PROFILE_UPDATE,
    PERMISSIONS.USERS_SKILLS_MANAGE,
    PERMISSIONS.USERS_FOLLOW_MANAGE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.CLASS_STUDENTS_READ,
    PERMISSIONS.ENROLLMENT_READ,
    PERMISSIONS.CURRICULUM_READ,
    PERMISSIONS.PROGRESS_SELF_READ,
    PERMISSIONS.PROGRESS_SELF_WRITE,
    PERMISSIONS.LABS_INSTANCE_CREATE,
    PERMISSIONS.LABS_INSTANCE_READ,
    PERMISSIONS.LABS_INSTANCE_DELETE,
    PERMISSIONS.LABS_AI_MENTOR_USE,
    PERMISSIONS.GAMIFICATION_PROFILE_READ,
    PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD,
    PERMISSIONS.NOTIFICATIONS_INBOX_READ,
    PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE,
    PERMISSIONS.CONTENT_REVIEW_CREATE,
    PERMISSIONS.CONTENT_COMMENT_CREATE,
    PERMISSIONS.CONTENT_LIKE_CREATE,
    PERMISSIONS.CONTENT_REPORT_CREATE,
    PERMISSIONS.EVENTS_REGISTER,
  ],
  [ROLES.INDIVIDUAL_LEARNER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
    PERMISSIONS.USERS_PROFILE_READ,
    PERMISSIONS.USERS_PROFILE_UPDATE,
    PERMISSIONS.USERS_SKILLS_MANAGE,
    PERMISSIONS.USERS_FOLLOW_MANAGE,
    PERMISSIONS.CURRICULUM_READ,
    PERMISSIONS.PROGRESS_SELF_READ,
    PERMISSIONS.PROGRESS_SELF_WRITE,
    PERMISSIONS.GAMIFICATION_PROFILE_READ,
    PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD,
    PERMISSIONS.NOTIFICATIONS_INBOX_READ,
    PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE,
    PERMISSIONS.CONTENT_REVIEW_CREATE,
    PERMISSIONS.CONTENT_COMMENT_CREATE,
    PERMISSIONS.CONTENT_LIKE_CREATE,
    PERMISSIONS.CONTENT_REPORT_CREATE,
    PERMISSIONS.EVENTS_REGISTER,
    PERMISSIONS.BILLING_SUBSCRIPTION_CREATE,
    PERMISSIONS.BILLING_SUBSCRIPTION_READ,
    PERMISSIONS.BILLING_SUBSCRIPTION_CANCEL,
    PERMISSIONS.BILLING_PAYMENT_METHOD_MANAGE,
    PERMISSIONS.BILLING_ORDER_READ,
    PERMISSIONS.BILLING_INVOICE_READ,
  ],
  [ROLES.GUEST]: [],
};

async function upsertPermission(def: PermissionDefinition): Promise<number> {
  const existing = await db.query.permissions.findFirst({
    where: eq(permissions.permissionName, def.name),
  });

  if (existing) {
    return existing.permissionId;
  }

  const inserted = await db.insert(permissions).values({
    permissionName: def.name,
    module: def.module,
    description: def.description,
  });

  const id = inserted[0]?.insertId;
  if (!id) {
    throw new Error(`Failed to create permission ${def.name}.`);
  }
  return id;
}

async function upsertRole(name: string, description: string, permissionIds: number[]): Promise<number> {
  const existing = await db.query.roles.findFirst({
    where: eq(roles.roleName, name),
  });

  let roleId: number;
  if (existing) {
    roleId = existing.roleId;
    await db.update(roles).set({ description }).where(eq(roles.roleId, roleId));
  } else {
    const inserted = await db.insert(roles).values({ roleName: name, description });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error(`Failed to create role ${name}.`);
    }
    roleId = id;
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionIds.length > 0) {
    await db.insert(rolePermissions).values(
      permissionIds.map((permissionId) => ({ roleId, permissionId })),
    );
  }

  return roleId;
}

export const skillCatalogSeeds = [
  // cloud — DevOps
  { skillName: 'Docker', category: 'cloud' as const, description: 'Containerization and image lifecycle management.' },
  { skillName: 'Kubernetes', category: 'cloud' as const, description: 'Container orchestration, clusters and workloads.' },
  { skillName: 'Terraform', category: 'cloud' as const, description: 'Infrastructure as Code provisioning and state management.' },
  { skillName: 'Ansible', category: 'cloud' as const, description: 'Configuration management and automation playbooks.' },
  { skillName: 'AWS', category: 'cloud' as const, description: 'Amazon Web Services core services and architecture.' },
  { skillName: 'Microsoft Azure', category: 'cloud' as const, description: 'Azure core services and architecture.' },
  { skillName: 'Google Cloud Platform', category: 'cloud' as const, description: 'GCP core services and architecture.' },
  { skillName: 'Linux Administration', category: 'cloud' as const, description: 'Linux system administration and troubleshooting.' },
  { skillName: 'Shell Scripting', category: 'cloud' as const, description: 'Bash scripting for automation pipelines.' },
  { skillName: 'Site Reliability Engineering', category: 'cloud' as const, description: 'SLIs, SLOs, error budgets and reliability practices.' },
  // governance — DevOps
  { skillName: 'CI/CD Pipelines', category: 'governance' as const, description: 'Continuous integration and delivery pipeline design.' },
  { skillName: 'Jenkins', category: 'governance' as const, description: 'Jenkins pipeline automation and shared libraries.' },
  { skillName: 'GitHub Actions', category: 'governance' as const, description: 'Workflow automation with GitHub Actions.' },
  { skillName: 'GitOps', category: 'governance' as const, description: 'Declarative infrastructure delivery via Git.' },
  { skillName: 'Policy as Code', category: 'governance' as const, description: 'Automated compliance and policy enforcement.' },
  { skillName: 'Compliance Auditing', category: 'governance' as const, description: 'Audit-ready infrastructure and release practices.' },
] as const;

export const systemSettingSeeds = [
  {
    settingKey: 'platform.registration.open',
    settingValue: { value: true },
    groupName: 'platform',
    description: 'Allow new user registration on the platform.',
    isEditable: true,
  },
  {
    settingKey: 'platform.maintenance.mode',
    settingValue: { value: false },
    groupName: 'platform',
    description: 'Place the platform in maintenance mode.',
    isEditable: true,
  },
  {
    settingKey: 'platform.avatar.max_size_mb',
    settingValue: { value: 5 },
    groupName: 'media',
    description: 'Maximum avatar upload size in megabytes.',
    isEditable: true,
  },
  {
    settingKey: 'platform.profile.default_visibility',
    settingValue: { value: true },
    groupName: 'profile',
    description: 'Default visibility for newly created user profiles.',
    isEditable: true,
  },
  {
    settingKey: 'platform.build.version',
    settingValue: { value: '1.0.0' },
    groupName: 'system',
    description: 'Current platform build version. Read-only.',
    isEditable: false,
  },
  // ─── F8 platform operations settings (SCR-F8-14) ─────────────────────────
  {
    settingKey: 'analytics.default_days',
    settingValue: { value: 30 },
    groupName: 'analytics',
    description: 'Default date range in days for analytics trend charts.',
    isEditable: true,
  },
  {
    settingKey: 'analytics.poll_interval_seconds',
    settingValue: { value: 60 },
    groupName: 'analytics',
    description: 'Notification bell polling interval in seconds.',
    isEditable: true,
  },
  {
    settingKey: 'reports.reason_categories',
    settingValue: {
      value: ['spam', 'harassment', 'inappropriate_content', 'false_information', 'copyright_violation', 'other'],
    },
    groupName: 'moderation',
    description: 'Allowed report reason categories for the report modal.',
    isEditable: true,
  },
  {
    settingKey: 'platform.notifications.opt_out_all',
    settingValue: { value: false },
    groupName: 'notifications',
    description: 'Master switch disabling all non-critical platform notifications.',
    isEditable: true,
  },
] as const;

/**
 * F8 transactional email templates (SCR-F8-13). Placeholders follow the
 * `{{camelCase}}` convention consumed by the EmailAdapter substitution engine.
 */
export const emailTemplateSeeds = [
  {
    templateKey: 'notification_generic',
    name: 'Platform notification',
    subject: '{{appName}} notification',
    bodyHtml: '<p>Hi {{userName}},</p><p>{{message}}</p>',
    bodyText: 'Hi {{userName}},\n\n{{message}}',
    placeholders: ['{{userName}}', '{{message}}'],
    isActive: true,
  },
  {
    templateKey: 'event_registration_confirmation',
    name: 'Event registration confirmation',
    subject: 'You are registered for {{eventTitle}}',
    bodyHtml:
      '<p>Hi {{userName}},</p><p>Your registration for <strong>{{eventTitle}}</strong> is confirmed.</p><p>Starts: {{eventStart}}</p>',
    bodyText: 'Hi {{userName}},\n\nYour registration for {{eventTitle}} is confirmed.\nStarts: {{eventStart}}',
    placeholders: ['{{userName}}', '{{eventTitle}}', '{{eventStart}}'],
    isActive: true,
  },
  {
    templateKey: 'announcement_notice',
    name: 'Announcement notice',
    subject: '{{announcementTitle}}',
    bodyHtml: '<p>Hi {{userName}},</p><p>{{announcementContent}}</p>',
    bodyText: 'Hi {{userName}},\n\n{{announcementContent}}',
    placeholders: ['{{userName}}', '{{announcementTitle}}', '{{announcementContent}}'],
    isActive: true,
  },
] as const;

async function seedSkillsCatalog(): Promise<void> {
  for (const seed of skillCatalogSeeds) {
    const existing = await db.query.skills.findFirst({
      where: eq(skills.skillName, seed.skillName),
    });
    if (existing) {
      continue;
    }
    await db.insert(skills).values(seed);
  }

  const count = await db.$count(skills);
  // eslint-disable-next-line no-console
  console.log(`Skills catalog seeded (${count} rows).`);
}

async function seedSystemSettings(): Promise<void> {
  for (const seed of systemSettingSeeds) {
    const existing = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.settingKey, seed.settingKey),
    });
    if (existing) {
      continue;
    }
    await db.insert(systemSettings).values({
      settingKey: seed.settingKey,
      settingValue: seed.settingValue,
      groupName: seed.groupName,
      description: seed.description,
      isEditable: seed.isEditable,
    });
  }

  const settings = await db.select().from(systemSettings);
  // eslint-disable-next-line no-console
  console.log(`System settings seeded (${settings.length} rows).`);
}

/** F8: seed the transactional email template catalog (idempotent). */
async function seedEmailTemplates(): Promise<void> {
  for (const seed of emailTemplateSeeds) {
    const existing = await db.query.emailTemplates.findFirst({
      where: eq(emailTemplates.templateKey, seed.templateKey),
    });
    if (existing) {
      continue;
    }
    await db.insert(emailTemplates).values(seed);
  }

  const count = await db.$count(emailTemplates);
  // eslint-disable-next-line no-console
  console.log(`Email templates seeded (${count} rows).`);
}

async function seedCountriesIfMissing(): Promise<void> {
  const rows = await db.select().from(countries);
  if (rows.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Countries catalog present (${rows.length} rows). Skipping seed.`);
    return;
  }

  const fallbackCountries = [
    { countryCode: 'US', countryName: 'United States', iso3Code: 'USA', phoneCode: '+1' },
    { countryCode: 'GB', countryName: 'United Kingdom', iso3Code: 'GBR', phoneCode: '+44' },
    { countryCode: 'DE', countryName: 'Germany', iso3Code: 'DEU', phoneCode: '+49' },
    { countryCode: 'FR', countryName: 'France', iso3Code: 'FRA', phoneCode: '+33' },
    { countryCode: 'PK', countryName: 'Pakistan', iso3Code: 'PAK', phoneCode: '+92' },
    { countryCode: 'AE', countryName: 'United Arab Emirates', iso3Code: 'ARE', phoneCode: '+971' },
    { countryCode: 'IN', countryName: 'India', iso3Code: 'IND', phoneCode: '+91' },
    { countryCode: 'SA', countryName: 'Saudi Arabia', iso3Code: 'SAU', phoneCode: '+966' },
    { countryCode: 'CA', countryName: 'Canada', iso3Code: 'CAN', phoneCode: '+1' },
    { countryCode: 'AU', countryName: 'Australia', iso3Code: 'AUS', phoneCode: '+61' },
  ];

  await db.insert(countries).values(fallbackCountries);
  // eslint-disable-next-line no-console
  console.log(`Countries catalog seeded (${fallbackCountries.length} rows).`);
}

/** F3 sentinel team anchoring org-level professor invitations (idempotent). */
async function seedOrgInviteSentinel(ownerUserId: number): Promise<void> {
  const existing = await db.query.teams.findFirst({
    where: eq(teams.slug, ORG_CONSTANTS.ORG_INVITE_SENTINEL_SLUG),
  });
  if (existing) {
    return;
  }

  await db.insert(teams).values({
    organizationId: null,
    teamName: 'Organization invitations',
    slug: ORG_CONSTANTS.ORG_INVITE_SENTINEL_SLUG,
    description: null,
    teamOwnerId: ownerUserId,
    isPublic: false,
    maxMembers: 0,
  });
  // eslint-disable-next-line no-console
  console.log('Organization invitation sentinel team seeded.');
}

const difficultyLevelSeeds = [
  { name: 'Very Easy', levelValue: 1, colorHex: '#00cc66', pointsMultiplier: '1.00' },
  { name: 'Easy', levelValue: 2, colorHex: '#00b4d8', pointsMultiplier: '1.20' },
  { name: 'Medium', levelValue: 3, colorHex: '#ffb703', pointsMultiplier: '1.50' },
  { name: 'Hard', levelValue: 4, colorHex: '#f94144', pointsMultiplier: '2.00' },
  { name: 'Insane', levelValue: 5, colorHex: '#7209b7', pointsMultiplier: '2.50' },
] as const;

const categorySeeds = [
  { name: 'Web', slug: 'web', description: 'Web application development and security' },
  { name: 'Reverse Engineering', slug: 'reverse-engineering', description: 'Reverse engineering and binary analysis' },
  { name: 'Forensics', slug: 'forensics', description: 'Digital forensics and analysis' },
  { name: 'Cryptography', slug: 'cryptography', description: 'Cryptographic challenges' },
  { name: 'Network', slug: 'network', description: 'Networking fundamentals and protocols' },
  { name: 'Cloud', slug: 'cloud', description: 'Cloud computing and infrastructure' },
  { name: 'AI/ML', slug: 'ai-ml', description: 'Artificial intelligence and machine learning security' },
] as const;

const tagSeeds = [
  { tagName: 'docker', slug: 'docker', colorHex: '#0db7ed' },
  { tagName: 'kubernetes', slug: 'kubernetes', colorHex: '#326ce5' },
  { tagName: 'aws', slug: 'aws', colorHex: '#ff9900' },
  { tagName: 'linux', slug: 'linux', colorHex: '#fcc624' },
  { tagName: 'terraform', slug: 'terraform', colorHex: '#7b42bc' },
  { tagName: 'ci-cd', slug: 'ci-cd', colorHex: '#e4482d' },
  { tagName: 'networking', slug: 'networking', colorHex: '#00b4d8' },
  { tagName: 'security', slug: 'security', colorHex: '#e5484d' },
] as const;

/** F4: difficulty taxonomy, categories, tags and the canonical course. */
async function seedCurriculumCatalog(adminUserId: number): Promise<void> {
  for (const seed of difficultyLevelSeeds) {
    const existing = await db.query.difficultyLevels.findFirst({
      where: eq(difficultyLevels.name, seed.name),
    });
    if (!existing) {
      await db.insert(difficultyLevels).values(seed);
    }
  }

  for (const seed of categorySeeds) {
    const existing = await db.query.categories.findFirst({
      where: eq(categories.slug, seed.slug),
    });
    if (!existing) {
      await db.insert(categories).values(seed);
    }
  }

  for (const seed of tagSeeds) {
    const existing = await db.query.tags.findFirst({
      where: eq(tags.slug, seed.slug),
    });
    if (!existing) {
      await db.insert(tags).values(seed);
    }
  }

  // §05 invariant 1: exactly one canonical course per deployment.
  const existingCourse = await db.query.academyCourses.findFirst({
    orderBy: (row, { asc }) => [asc(row.courseId)],
  });
  if (!existingCourse) {
    const medium = await db.query.difficultyLevels.findFirst({
      where: eq(difficultyLevels.name, 'Medium'),
    });
    const cloud = await db.query.categories.findFirst({
      where: eq(categories.slug, 'cloud'),
    });
    await db.insert(academyCourses).values({
      title: 'DevOps Mentor',
      slug: 'devops-mentor',
      description: 'End-to-end DevOps engineering curriculum.',
      difficultyId: medium?.difficultyId ?? 3,
      categoryId: cloud?.categoryId ?? null,
      instructorId: adminUserId,
      estimatedHours: 40,
      isPublished: true,
      prerequisites: null,
      learningObjectives: null,
    });
  }

  // eslint-disable-next-line no-console
  console.log('Curriculum catalog seeded (difficulties, categories, tags, course).');
}

async function main(): Promise<void> {
  const permissionIds = new Map<string, number>();

  for (const def of permissionDefinitions) {
    permissionIds.set(def.name, await upsertPermission(def));
  }

  const describe: Record<string, string> = {
    [ROLES.PLATFORM_ADMIN]: 'Full platform administration access',
    [ROLES.ORG_ADMIN]: 'Organization administration access',
    [ROLES.PROFESSOR]: 'Instructor and cohort access',
    [ROLES.ORG_STUDENT]: 'Enrolled organizational learner access',
    [ROLES.INDIVIDUAL_LEARNER]: 'Default individual learner access',
    [ROLES.GUEST]: 'Unauthenticated guest access',
  };

  for (const [roleName, permissionNames] of Object.entries(rolePermissionMatrix)) {
    const ids = permissionNames
      .map((name) => permissionIds.get(name))
      .filter((id): id is number => id !== undefined);
    await upsertRole(roleName, describe[roleName] ?? '', ids);
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@devopsmentor.local';
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? (env.NODE_ENV === 'production' ? '' : 'Admin@12345');

  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set in production.');
  }

  const adminRole = await db.query.roles.findFirst({
    where: eq(roles.roleName, ROLES.PLATFORM_ADMIN),
  });

  if (!adminRole) {
    throw new Error('platform_admin role missing after seeding.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, env.BCRYPT_SALT_ROUNDS);
  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, adminEmail),
  });

  let adminId: number;
  if (existingAdmin) {
    adminId = existingAdmin.userId;
    await db
      .update(users)
      .set({ passwordHash, isVerified: true, isActive: true, isBanned: false, deletedAt: null })
      .where(eq(users.userId, adminId));
  } else {
    const inserted = await db.insert(users).values({
      username: 'platform_admin',
      email: adminEmail,
      passwordHash,
      salt: '',
      fullName: 'Platform Admin',
      isVerified: true,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create platform admin.');
    }
    adminId = id;
  }

  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.insert(userRoles).values({ userId: adminId, roleId: adminRole.roleId });

  const usCountry = await db.query.countries.findFirst({ where: eq(countries.countryCode, 'US') });
  await db
    .insert(userProfiles)
    .values({
      userId: adminId,
      countryId: usCountry?.countryId ?? null,
      occupation: 'Platform Director / Root Administrator',
      company: 'DevOps Mentor',
      website: 'https://devopsmentor.local',
      githubUrl: 'https://github.com/devopsmentor',
      city: 'San Francisco',
      isPublic: true,
    })
    .onDuplicateKeyUpdate({
      set: {
        countryId: usCountry?.countryId ?? null,
        occupation: 'Platform Director / Root Administrator',
        company: 'DevOps Mentor',
        website: 'https://devopsmentor.local',
        githubUrl: 'https://github.com/devopsmentor',
        city: 'San Francisco',
        isPublic: true,
      },
    });

  await seedOrgInviteSentinel(adminId);
  await seedCurriculumCatalog(adminId);
  await seedSkillsCatalog();
  await seedSystemSettings();
  await seedEmailTemplates();
  await seedCountriesIfMissing();
  await seedTestOrganizationsAndUsers(passwordHash);

  // eslint-disable-next-line no-console
  console.log('Seed completed successfully.');
}

async function seedTestOrganizationsAndUsers(passwordHash: string): Promise<void> {
  const orgAdminRole = await db.query.roles.findFirst({ where: eq(roles.roleName, ROLES.ORG_ADMIN) });
  const professorRole = await db.query.roles.findFirst({ where: eq(roles.roleName, ROLES.PROFESSOR) });
  const studentRole = await db.query.roles.findFirst({ where: eq(roles.roleName, ROLES.ORG_STUDENT) });
  const learnerRole = await db.query.roles.findFirst({ where: eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER) });

  if (!orgAdminRole || !professorRole || !studentRole || !learnerRole) {
    throw new Error('Core roles missing before seeding test users.');
  }

  const usCountry = await db.query.countries.findFirst({ where: eq(countries.countryCode, 'US') });
  const sampleSkills = await db.select().from(skills).limit(5);

  type ProfileSeedInput = {
    occupation: string;
    company: string;
    website?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    city?: string;
  };

  // 1. Seed Organization
  let org = await db.query.organizations.findFirst({ where: eq(organizations.slug, 'acme-engineering') });
  let orgId: number;
  if (!org) {
    const inserted = await db.insert(organizations).values({
      name: 'Acme Engineering Academy',
      slug: 'acme-engineering',
      description: 'University and Enterprise Cloud Infrastructure Cohorts',
      website: 'https://acme.local',
      industry: 'Higher Education',
      billingEmail: 'billing@acme.local',
      isVerified: true,
    });
    const id = inserted[0]?.insertId;
    if (!id) throw new Error('Failed to insert test organization');
    orgId = id;
  } else {
    orgId = org.organizationId;
  }

  // Helper to upsert test user with role, optional org scope, and profile data
  async function upsertTestUser(
    email: string,
    username: string,
    fullName: string,
    roleId: number,
    orgScopeId?: number,
    profileInput?: ProfileSeedInput,
  ): Promise<number> {
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    let userId: number;
    if (existing) {
      userId = existing.userId;
      await db
        .update(users)
        .set({ passwordHash, isVerified: true, isActive: true, isBanned: false, deletedAt: null })
        .where(eq(users.userId, userId));
    } else {
      const inserted = await db.insert(users).values({
        email,
        username,
        fullName,
        passwordHash,
        salt: '',
        isVerified: true,
      });
      const id = inserted[0]?.insertId;
      if (!id) throw new Error(`Failed to create test user ${email}`);
      userId = id;
    }

    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.insert(userRoles).values({ userId, roleId });

    if (orgScopeId) {
      await db
        .insert(userSettings)
        .values({
          userId,
          settingKey: ORG_CONSTANTS.ORG_ID_SETTING_KEY,
          settingValue: orgScopeId,
        })
        .onDuplicateKeyUpdate({ set: { settingValue: orgScopeId } });
    }

    if (profileInput) {
      await db
        .insert(userProfiles)
        .values({
          userId,
          countryId: usCountry?.countryId ?? null,
          occupation: profileInput.occupation,
          company: profileInput.company,
          website: profileInput.website ?? null,
          githubUrl: profileInput.githubUrl ?? null,
          linkedinUrl: profileInput.linkedinUrl ?? null,
          city: profileInput.city ?? 'San Francisco',
          isPublic: true,
        })
        .onDuplicateKeyUpdate({
          set: {
            countryId: usCountry?.countryId ?? null,
            occupation: profileInput.occupation,
            company: profileInput.company,
            website: profileInput.website ?? null,
            githubUrl: profileInput.githubUrl ?? null,
            linkedinUrl: profileInput.linkedinUrl ?? null,
            city: profileInput.city ?? 'San Francisco',
            isPublic: true,
          },
        });
    }

    if (sampleSkills.length > 0) {
      for (const sk of sampleSkills.slice(0, 3)) {
        await db
          .insert(userSkills)
          .values({
            userId,
            skillId: sk.skillId,
            proficiencyLevel: 'advanced',
            yearsExperience: '2.5',
            isVerified: true,
          })
          .onDuplicateKeyUpdate({ set: { proficiencyLevel: 'advanced', isVerified: true } });
      }
    }

    return userId;
  }

  // 2. Org Admin
  await upsertTestUser(
    'orgadmin@acme.local',
    'acme_admin',
    'Acme Org Administrator',
    orgAdminRole.roleId,
    orgId,
    {
      occupation: 'Head of Infrastructure Academics',
      company: 'Acme Engineering Academy',
      website: 'https://acme.local',
      githubUrl: 'https://github.com/acme-admin',
    },
  );

  // Also support legacy acme.edu org admin if present
  const legacyOrgAdmin = await db.query.users.findFirst({ where: eq(users.email, 'orgadmin@acme.edu') });
  if (legacyOrgAdmin) {
    await upsertTestUser(
      'orgadmin@acme.edu',
      legacyOrgAdmin.username,
      legacyOrgAdmin.fullName ?? 'Acme Admin',
      orgAdminRole.roleId,
      1,
      {
        occupation: 'Acme University Admin',
        company: 'Acme University',
      },
    );
  }

  // 3. Professor
  const profId = await upsertTestUser(
    'professor@acme.local',
    'prof_chen',
    'Prof. Sarah Chen',
    professorRole.roleId,
    orgId,
    {
      occupation: 'Associate Professor of Cloud Systems',
      company: 'Acme Engineering Academy',
      website: 'https://acme.local/faculty/chen',
      githubUrl: 'https://github.com/prof-chen',
    },
  );

  // 4. Individual Learner
  await upsertTestUser(
    'learner@devopsmentor.local',
    'solo_learner',
    'Jordan Blake',
    learnerRole.roleId,
    undefined,
    {
      occupation: 'Site Reliability Engineering Learner',
      company: 'Independent SRE',
      githubUrl: 'https://github.com/jordan-blake-ops',
    },
  );

  // 5. Seed Class / Cohort
  const classRow = await db.query.teams.findFirst({ where: eq(teams.slug, 'cs401-fall2026') });
  let classId: number;
  if (!classRow) {
    const inserted = await db.insert(teams).values({
      organizationId: orgId,
      teamName: 'CS 401: Cloud & DevOps Fall 2026',
      slug: 'cs401-fall2026',
      description: 'Distributed Systems, Linux Containers and Kubernetes Networking',
      teamOwnerId: profId,
      maxMembers: 50,
      isPublic: false,
    });
    const id = inserted[0]?.insertId;
    if (!id) throw new Error('Failed to create test class');
    classId = id;
  } else {
    classId = classRow.teamId;
  }

  // 6. Enrolled Students
  const student1Id = await upsertTestUser(
    'student1@acme.local',
    'alex_rivera',
    'Alex Rivera',
    studentRole.roleId,
    orgId,
    {
      occupation: 'Graduate Cloud Engineering Student',
      company: 'Acme Engineering Academy',
      githubUrl: 'https://github.com/arivera-ops',
    },
  );
  const student2Id = await upsertTestUser(
    'student2@acme.local',
    'marcus_vance',
    'Marcus Vance',
    studentRole.roleId,
    orgId,
    {
      occupation: 'Undergraduate Systems Engineering Student',
      company: 'Acme Engineering Academy',
      githubUrl: 'https://github.com/mvance-sys',
    },
  );

  // Also support legacy student if present
  const legacyStudent = await db.query.users.findFirst({ where: eq(users.email, 'student1@acme.edu') });
  if (legacyStudent) {
    await upsertTestUser(
      'student1@acme.edu',
      legacyStudent.username,
      legacyStudent.fullName ?? 'Student One',
      studentRole.roleId,
      1,
      {
        occupation: 'Acme University DevOps Student',
        company: 'Acme University',
      },
    );
  }

  // Also support personal local testing account if present
  const localDevUser = await db.query.users.findFirst({ where: eq(users.email, 'abdullahniazi078@gmail.com') });
  if (localDevUser) {
    await upsertTestUser(
      'abdullahniazi078@gmail.com',
      localDevUser.username,
      localDevUser.fullName ?? 'Abdullah Niazi',
      orgAdminRole.roleId,
      orgId,
      {
        occupation: 'Lead Cloud Infrastructure Architect',
        company: 'DevOps Mentor Academy',
      },
    );
  }

  for (const sId of [student1Id, student2Id]) {
    await db
      .insert(teamMembers)
      .values({
        teamId: classId,
        userId: sId,
        role: 'member',
        isActive: true,
      })
      .onDuplicateKeyUpdate({ set: { isActive: true, role: 'member' } });
  }

  await db
    .insert(teamMembers)
    .values({
      teamId: classId,
      userId: profId,
      role: 'captain',
      isActive: true,
    })
    .onDuplicateKeyUpdate({ set: { isActive: true, role: 'captain' } });

  // 7. Seed sample pending invitation for testing
  const testInviteToken = 'test-invite-token-cs401';
  const expiresAt = new Date(Date.now() + ORG_CONSTANTS.INVITE_TTL_SECONDS * 1000);
  await db
    .insert(teamInvitations)
    .values({
      teamId: classId,
      inviterId: profId,
      inviteeEmail: 'pending.student@acme.local',
      token: testInviteToken,
      status: 'pending',
      expiresAt,
    })
    .onDuplicateKeyUpdate({ set: { status: 'pending', expiresAt } });

  // eslint-disable-next-line no-console
  console.log('Seeded test organizations, cohorts, and 5 role test accounts:');
  // eslint-disable-next-line no-console
  console.log('  - Platform Admin: admin@devopsmentor.local / Admin@12345');
  // eslint-disable-next-line no-console
  console.log('  - Org Admin:      orgadmin@acme.local / Admin@12345 (and orgadmin@acme.edu)');
  // eslint-disable-next-line no-console
  console.log('  - Professor:      professor@acme.local / Admin@12345');
  // eslint-disable-next-line no-console
  console.log('  - Org Student 1:  student1@acme.local / Admin@12345 (and student1@acme.edu)');
  // eslint-disable-next-line no-console
  console.log('  - Org Student 2:  student2@acme.local / Admin@12345');
  // eslint-disable-next-line no-console
  console.log('  - Learner:        learner@devopsmentor.local / Admin@12345');
  // eslint-disable-next-line no-console
  console.log(
    `  - Test Invitation: Token "${testInviteToken}" (Expires in ${ORG_CONSTANTS.INVITE_TTL_HOURS}h)`,
  );
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDatabase();
  });