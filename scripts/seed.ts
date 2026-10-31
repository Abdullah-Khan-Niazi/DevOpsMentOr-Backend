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
  pool,
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
import { redisClient } from '../src/app/cache/redis';
import { PERMISSIONS, ORG_CONSTANTS, ROLES } from '../src/shared/constants';
import { env } from '../src/app/config';

dotenv.config();

/**
 * DESTRUCTIVE development seed.
 *
 * Every application table except `__drizzle_migrations` is truncated, the
 * application Redis namespace is cleared, then a fixed fixture set is inserted
 * with known IDs. Re-running the script resets the database to the same shape;
 * it is intentionally NOT an incremental/idempotent production migration.
 *
 * Every seeded account shares one password (SEED_PASSWORD, falling back to
 * SEED_ADMIN_PASSWORD, then a development-only default).
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

/**
 * Fixed ID allocation:
 *   permission_id = 1..N in `permissionDefinitions` order
 *   role_id       = 1..6 in `rolePermissionMatrix` order
 * The seed always uses the same IDs so fixtures can be referenced from tests,
 * browser bookmarks, and manual API checks.
 */
async function seedAccessControl(): Promise<Map<string, number>> {
  const permissionRows = permissionDefinitions.map((def, index) => ({
    permissionId: index + 1,
    permissionName: def.name,
    module: def.module,
    description: def.description,
  }));
  await db.insert(permissions).values(permissionRows);

  const permissionIds = new Map(
    permissionRows.map((row) => [row.permissionName, row.permissionId]),
  );

  const describe: Record<string, string> = {
    [ROLES.PLATFORM_ADMIN]: 'Full platform administration access',
    [ROLES.ORG_ADMIN]: 'Organization administration access',
    [ROLES.PROFESSOR]: 'Instructor and cohort access',
    [ROLES.ORG_STUDENT]: 'Enrolled organizational learner access',
    [ROLES.INDIVIDUAL_LEARNER]: 'Default individual learner access',
    [ROLES.GUEST]: 'Unauthenticated guest access',
  };
  const priorities = [100, 80, 70, 50, 30, 10];
  const roleRows = Object.keys(rolePermissionMatrix).map((roleName, index) => ({
    roleId: index + 1,
    roleName,
    description: describe[roleName] ?? '',
    priority: priorities[index] ?? 0,
  }));
  await db.insert(roles).values(roleRows);
  const roleIds = new Map(roleRows.map((row) => [row.roleName, row.roleId]));

  const grants: Array<{ roleId: number; permissionId: number }> = [];
  for (const [roleName, permissionNames] of Object.entries(rolePermissionMatrix)) {
    const roleId = roleIds.get(roleName);
    if (!roleId) {
      throw new Error(`Missing role id for ${roleName}.`);
    }
    for (const permissionName of permissionNames) {
      const permissionId = permissionIds.get(permissionName);
      if (!permissionId) {
        throw new Error(`Missing permission id for ${permissionName}.`);
      }
      grants.push({ roleId, permissionId });
    }
  }
  await db.insert(rolePermissions).values(grants);

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${permissionRows.length} permissions, ${roleRows.length} roles, ${grants.length} grants.`,
  );
  return roleIds;
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

/**
 * Truncate every application table on one pooled connection. Foreign-key
 * checks are disabled only for the duration of the purge, and Drizzle's
 * migration journal is preserved so schema state is untouched.
 */
async function purgeDatabase(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS tableName
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME <> '__drizzle_migrations'`,
    );
    const tables = (rows as Array<{ tableName: string }>)
      .map((row) => row.tableName)
      .filter((tableName) => tableName.length > 0);

    for (const table of tables) {
      const escaped = table.replace(/`/g, '``');
      await connection.query(`TRUNCATE TABLE \`${escaped}\``);
    }

    // eslint-disable-next-line no-console
    console.log(`Purged ${tables.length} application tables (migrations preserved).`);
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();
  }
}

/**
 * Clear every cache namespace that can outlive a database reset. This runs
 * before truncation so a Redis failure aborts before the database is emptied.
 */
async function clearRedisCache(): Promise<void> {
  const patterns = [
    'org:class_join:*',
    'org:class_join_codes:*',
    'org:class_join_attempts:*',
    'org_admin_invite:*',
    'admin_invite:*',
    'rate:*',
    'identity:*',
    'jti:*',
    'course_progress:*',
    'ai_mentor:*',
    'ai_mentor_rate:*',
    'lab_extend:*',
    'lp_stats',
    'admin_kpi',
  ];

  let deleted = 0;
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await redisClient.del(...keys);
      }
    } while (cursor !== '0');
  }

  // eslint-disable-next-line no-console
  console.log(`Cleared ${deleted} application cache keys.`);
}

interface SeedUser {
  userId: number;
  email: string;
  username: string;
  fullName: string;
  roleName: string;
  orgId?: number;
  occupation: string;
  company: string;
  website?: string;
  githubUrl?: string;
  city?: string;
}

/**
 * Fixed organization / class / account fixtures.
 *
 * Users 1–12 cover every role exactly as assigned below. Students 7 and 9 are
 * deliberately enrolled in two classes each so multi-class context can be
 * exercised without additional data setup.
 */
async function seedOrganizationsClassesAndUsers(
  roleIds: Map<string, number>,
  passwordHash: string,
  seedPassword: string,
): Promise<void> {
  await db.insert(organizations).values([
    {
      organizationId: 1,
      name: 'Acme Engineering Academy',
      slug: 'acme-engineering',
      description: 'University and enterprise cloud infrastructure cohorts.',
      website: 'https://acme.local',
      industry: 'Higher Education',
      billingEmail: 'billing@acme.local',
      isVerified: true,
    },
    {
      organizationId: 2,
      name: 'Globex Cloud Institute',
      slug: 'globex-cloud',
      description: 'Cloud security and site reliability training programs.',
      website: 'https://globex.local',
      industry: 'Professional Training',
      billingEmail: 'billing@globex.local',
      isVerified: true,
    },
  ]);

  await db.insert(systemSettings).values([
    {
      settingKey: ORG_CONSTANTS.ORG_EMAIL_DOMAIN_KEY(1),
      settingValue: 'acme.local',
      groupName: 'org',
      description: 'Enrollment email domain for Acme Engineering Academy.',
      updatedBy: 2,
    },
    {
      settingKey: ORG_CONSTANTS.ORG_EMAIL_DOMAIN_KEY(2),
      settingValue: 'globex.local',
      groupName: 'org',
      description: 'Enrollment email domain for Globex Cloud Institute.',
      updatedBy: 5,
    },
  ]);

  const seedUsers: SeedUser[] = [
    {
      userId: 1,
      email: 'admin@devopsmentor.local',
      username: 'platform_admin',
      fullName: 'Platform Admin',
      roleName: ROLES.PLATFORM_ADMIN,
      occupation: 'Platform Director / Root Administrator',
      company: 'DevOps Mentor',
      website: 'https://devopsmentor.local',
      githubUrl: 'https://github.com/devopsmentor',
      city: 'San Francisco',
    },
    {
      userId: 2,
      email: 'orgadmin@acme.local',
      username: 'acme_admin',
      fullName: 'Acme Org Administrator',
      roleName: ROLES.ORG_ADMIN,
      orgId: 1,
      occupation: 'Head of Infrastructure Academics',
      company: 'Acme Engineering Academy',
      website: 'https://acme.local',
      githubUrl: 'https://github.com/acme-admin',
      city: 'Boston',
    },
    {
      userId: 3,
      email: 'professor@acme.local',
      username: 'prof_chen',
      fullName: 'Prof. Sarah Chen',
      roleName: ROLES.PROFESSOR,
      orgId: 1,
      occupation: 'Associate Professor of Cloud Systems',
      company: 'Acme Engineering Academy',
      website: 'https://acme.local/faculty/chen',
      githubUrl: 'https://github.com/prof-chen',
      city: 'Boston',
    },
    {
      userId: 4,
      email: 'professor2@acme.local',
      username: 'prof_haddad',
      fullName: 'Prof. Omar Haddad',
      roleName: ROLES.PROFESSOR,
      orgId: 1,
      occupation: 'Senior Lecturer, Platform Engineering',
      company: 'Acme Engineering Academy',
      website: 'https://acme.local/faculty/haddad',
      githubUrl: 'https://github.com/prof-haddad',
      city: 'Boston',
    },
    {
      userId: 5,
      email: 'orgadmin@globex.local',
      username: 'globex_admin',
      fullName: 'Globex Org Administrator',
      roleName: ROLES.ORG_ADMIN,
      orgId: 2,
      occupation: 'Director of Cloud Programs',
      company: 'Globex Cloud Institute',
      website: 'https://globex.local',
      githubUrl: 'https://github.com/globex-admin',
      city: 'Seattle',
    },
    {
      userId: 6,
      email: 'professor@globex.local',
      username: 'prof_rossi',
      fullName: 'Prof. Elena Rossi',
      roleName: ROLES.PROFESSOR,
      orgId: 2,
      occupation: 'Professor of Cloud Security',
      company: 'Globex Cloud Institute',
      website: 'https://globex.local/faculty/rossi',
      githubUrl: 'https://github.com/prof-rossi',
      city: 'Seattle',
    },
    {
      userId: 7,
      email: 'student1@acme.local',
      username: 'alex_rivera',
      fullName: 'Alex Rivera',
      roleName: ROLES.ORG_STUDENT,
      orgId: 1,
      occupation: 'Graduate Cloud Engineering Student',
      company: 'Acme Engineering Academy',
      githubUrl: 'https://github.com/arivera-ops',
      city: 'Boston',
    },
    {
      userId: 8,
      email: 'student2@acme.local',
      username: 'marcus_vance',
      fullName: 'Marcus Vance',
      roleName: ROLES.ORG_STUDENT,
      orgId: 1,
      occupation: 'Undergraduate Systems Engineering Student',
      company: 'Acme Engineering Academy',
      githubUrl: 'https://github.com/mvance-sys',
      city: 'Boston',
    },
    {
      userId: 9,
      email: 'student3@globex.local',
      username: 'priya_nair',
      fullName: 'Priya Nair',
      roleName: ROLES.ORG_STUDENT,
      orgId: 2,
      occupation: 'Cloud Security Graduate Student',
      company: 'Globex Cloud Institute',
      githubUrl: 'https://github.com/priya-nair-cloud',
      city: 'Seattle',
    },
    {
      userId: 10,
      email: 'student4@globex.local',
      username: 'diego_alvarez',
      fullName: 'Diego Alvarez',
      roleName: ROLES.ORG_STUDENT,
      orgId: 2,
      occupation: 'SRE Foundations Student',
      company: 'Globex Cloud Institute',
      githubUrl: 'https://github.com/diego-alvarez-sre',
      city: 'Seattle',
    },
    {
      userId: 11,
      email: 'learner@devopsmentor.local',
      username: 'solo_learner',
      fullName: 'Jordan Blake',
      roleName: ROLES.INDIVIDUAL_LEARNER,
      occupation: 'Site Reliability Engineering Learner',
      company: 'Independent SRE',
      githubUrl: 'https://github.com/jordan-blake-ops',
      city: 'Austin',
    },
    {
      userId: 12,
      email: 'guest@devopsmentor.local',
      username: 'guest_user',
      fullName: 'Guest User',
      roleName: ROLES.GUEST,
      occupation: 'Guest Explorer',
      company: 'DevOps Mentor',
      city: 'San Francisco',
    },
  ];

  await db.insert(users).values(
    seedUsers.map((user) => ({
      userId: user.userId,
      username: user.username,
      email: user.email,
      passwordHash,
      salt: '',
      fullName: user.fullName,
      isVerified: true,
      isActive: true,
      isBanned: false,
    })),
  );

  const usCountry = await db.query.countries.findFirst({
    where: eq(countries.countryCode, 'US'),
  });
  await db.insert(userProfiles).values(
    seedUsers.map((user) => ({
      userId: user.userId,
      countryId: usCountry?.countryId ?? null,
      city: user.city ?? 'San Francisco',
      occupation: user.occupation,
      company: user.company,
      website: user.website ?? null,
      githubUrl: user.githubUrl ?? null,
      isPublic: true,
    })),
  );

  const userRoleRows: Array<{ userId: number; roleId: number }> = [];
  for (const user of seedUsers) {
    const roleId = roleIds.get(user.roleName);
    if (!roleId) {
      throw new Error(`Role ${user.roleName} was not seeded.`);
    }
    userRoleRows.push({ userId: user.userId, roleId });
  }
  await db.insert(userRoles).values(userRoleRows);

  const scopedUsers = seedUsers.filter((user) => user.orgId !== undefined);
  if (scopedUsers.length > 0) {
    await db.insert(userSettings).values(
      scopedUsers.map((user) => ({
        userId: user.userId,
        settingKey: ORG_CONSTANTS.ORG_ID_SETTING_KEY,
        settingValue: user.orgId as number,
      })),
    );
  }

  const sampleSkills = await db.select({ skillId: skills.skillId }).from(skills).limit(3);
  if (sampleSkills.length > 0) {
    const skillRows: Array<{
      userId: number;
      skillId: number;
      proficiencyLevel: 'advanced';
      yearsExperience: string;
      isVerified: boolean;
    }> = [];
    for (const user of seedUsers) {
      for (const skill of sampleSkills) {
        skillRows.push({
          userId: user.userId,
          skillId: skill.skillId,
          proficiencyLevel: 'advanced',
          yearsExperience: '2.5',
          isVerified: true,
        });
      }
    }
    await db.insert(userSkills).values(skillRows);
  }

  await db.insert(teams).values([
    {
      teamId: 1,
      organizationId: 1,
      teamName: 'CS 401: Cloud & DevOps Fall 2026',
      slug: 'cs401-fall2026',
      description: 'Distributed systems, Linux containers and Kubernetes networking.',
      teamOwnerId: 3,
      maxMembers: 50,
      isPublic: false,
    },
    {
      teamId: 2,
      organizationId: 1,
      teamName: 'CS 402: Kubernetes Operations',
      slug: 'cs402-kubernetes',
      description: 'Cluster operations, workload reliability and GitOps delivery.',
      teamOwnerId: 3,
      maxMembers: 40,
      isPublic: false,
    },
    {
      teamId: 3,
      organizationId: 1,
      teamName: 'CS 403: Platform Engineering',
      slug: 'cs403-platform',
      description: 'Internal developer platforms, golden paths and service ownership.',
      teamOwnerId: 4,
      maxMembers: 35,
      isPublic: false,
    },
    {
      teamId: 4,
      organizationId: 2,
      teamName: 'GLX 210: Cloud Security',
      slug: 'glx210-cloud-security',
      description: 'Identity, network segmentation and cloud threat detection.',
      teamOwnerId: 6,
      maxMembers: 45,
      isPublic: false,
    },
    {
      teamId: 5,
      organizationId: 2,
      teamName: 'GLX 220: SRE Foundations',
      slug: 'glx220-sre-foundations',
      description: 'SLOs, incident response and production readiness.',
      teamOwnerId: 6,
      maxMembers: 40,
      isPublic: false,
    },
    {
      // F3 sentinel team: anchors org-level professor invitations.
      teamId: 6,
      organizationId: null,
      teamName: 'Organization invitations',
      slug: ORG_CONSTANTS.ORG_INVITE_SENTINEL_SLUG,
      description: null,
      teamOwnerId: 1,
      maxMembers: 0,
      isPublic: false,
    },
  ]);

  const professorJoinedAt = new Date('2026-08-15T00:00:00.000Z');
  const studentJoinedAt = new Date('2026-09-01T00:00:00.000Z');
  await db.insert(teamMembers).values([
    { teamId: 1, userId: 3, role: 'captain', isActive: true, joinedAt: professorJoinedAt },
    { teamId: 2, userId: 3, role: 'captain', isActive: true, joinedAt: professorJoinedAt },
    { teamId: 3, userId: 4, role: 'captain', isActive: true, joinedAt: professorJoinedAt },
    { teamId: 4, userId: 6, role: 'captain', isActive: true, joinedAt: professorJoinedAt },
    { teamId: 5, userId: 6, role: 'captain', isActive: true, joinedAt: professorJoinedAt },
    { teamId: 1, userId: 7, role: 'member', isActive: true, joinedAt: studentJoinedAt },
    { teamId: 1, userId: 8, role: 'member', isActive: true, joinedAt: studentJoinedAt },
    { teamId: 2, userId: 7, role: 'member', isActive: true, joinedAt: studentJoinedAt },
    { teamId: 4, userId: 9, role: 'member', isActive: true, joinedAt: studentJoinedAt },
    { teamId: 4, userId: 10, role: 'member', isActive: true, joinedAt: studentJoinedAt },
    { teamId: 5, userId: 9, role: 'member', isActive: true, joinedAt: studentJoinedAt },
  ]);

  const invitationExpiresAt = new Date(Date.now() + ORG_CONSTANTS.INVITE_TTL_SECONDS * 1000);
  await db.insert(teamInvitations).values({
    invitationId: 1,
    teamId: 1,
    inviterId: 3,
    inviteeEmail: 'pending.student@acme.local',
    token: 'test-invite-token-cs401',
    status: 'pending',
    expiresAt: invitationExpiresAt,
  });

  // eslint-disable-next-line no-console
  console.log('Seeded fixed organizations, classes, rosters and accounts:');
  for (const user of seedUsers) {
    const orgLabel =
      user.orgId === 1 ? 'Acme' : user.orgId === 2 ? 'Globex' : user.roleName === ROLES.GUEST ? 'Public' : 'Personal';
    // eslint-disable-next-line no-console
    console.log(
      `  ${String(user.userId).padStart(2, '0')}  ${user.roleName.padEnd(19)} ${user.email.padEnd(31)} ${orgLabel}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('  Multi-class learners: student1@acme.local (classes 1, 2), student3@globex.local (classes 4, 5)');
  // eslint-disable-next-line no-console
  console.log('  Pending invitation: token "test-invite-token-cs401" for pending.student@acme.local (class 1)');
  if (env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`  Password for every account: ${seedPassword}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('  Password for every account: supplied via SEED_PASSWORD / SEED_ADMIN_PASSWORD.');
  }
}

async function main(): Promise<void> {
  const seedPassword =
    process.env.SEED_PASSWORD ??
    process.env.SEED_ADMIN_PASSWORD ??
    (env.NODE_ENV === 'production' ? '' : 'Admin@12345');

  if (!seedPassword) {
    throw new Error('SEED_PASSWORD (or SEED_ADMIN_PASSWORD) must be set in production.');
  }

  await clearRedisCache();
  await purgeDatabase();

  const roleIds = await seedAccessControl();
  await seedCountriesIfMissing();
  await seedSkillsCatalog();
  await seedSystemSettings();
  await seedEmailTemplates();

  const passwordHash = await bcrypt.hash(seedPassword, env.BCRYPT_SALT_ROUNDS);
  await seedOrganizationsClassesAndUsers(roleIds, passwordHash, seedPassword);
  await seedCurriculumCatalog(1);

  // eslint-disable-next-line no-console
  console.log('Seed completed successfully.');
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await redisClient.quit();
    } catch {
      // Redis may already be closed after a connection failure.
    }
    await disconnectDatabase();
  });