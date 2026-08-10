import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import {
  countries,
  db,
  disconnectDatabase,
  permissions,
  rolePermissions,
  roles,
  skills,
  systemSettings,
  userRoles,
  users,
} from '../src/app/database';
import { PERMISSIONS, ROLES } from '../src/shared/constants';
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

  await seedSkillsCatalog();
  await seedSystemSettings();
  await seedCountriesIfMissing();

  // eslint-disable-next-line no-console
  console.log('Seed completed.');
  // eslint-disable-next-line no-console
  console.log(`Admin login: ${adminEmail}`);
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