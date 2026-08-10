import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import {
  db,
  disconnectDatabase,
  permissions,
  rolePermissions,
  roles,
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
  ],
  [ROLES.ORG_STUDENT]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
  ],
  [ROLES.INDIVIDUAL_LEARNER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.AUTH_SESSION_READ,
    PERMISSIONS.AUTH_SESSION_DELETE,
    PERMISSIONS.AUTH_APITOKEN_CREATE,
    PERMISSIONS.AUTH_APITOKEN_READ,
    PERMISSIONS.AUTH_APITOKEN_DELETE,
    PERMISSIONS.AUTH_LOGIN_HISTORY_READ,
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