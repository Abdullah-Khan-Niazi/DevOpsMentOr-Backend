import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  db,
  disconnectDatabase,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../src/app/database';
import { PERMISSIONS, ROLES, UserStatus } from '../src/shared/constants';
import { createId } from '../src/shared/utils';

const permissionDefinitions = [
  { name: PERMISSIONS.USERS_READ, resource: 'users', action: 'read', description: 'Read users' },
  {
    name: PERMISSIONS.USERS_CREATE,
    resource: 'users',
    action: 'create',
    description: 'Create users',
  },
  {
    name: PERMISSIONS.USERS_UPDATE,
    resource: 'users',
    action: 'update',
    description: 'Update users',
  },
  {
    name: PERMISSIONS.USERS_DELETE,
    resource: 'users',
    action: 'delete',
    description: 'Delete users',
  },
  { name: PERMISSIONS.ROLES_READ, resource: 'roles', action: 'read', description: 'Read roles' },
  {
    name: PERMISSIONS.ROLES_CREATE,
    resource: 'roles',
    action: 'create',
    description: 'Create roles',
  },
  {
    name: PERMISSIONS.ROLES_UPDATE,
    resource: 'roles',
    action: 'update',
    description: 'Update roles',
  },
  {
    name: PERMISSIONS.ROLES_DELETE,
    resource: 'roles',
    action: 'delete',
    description: 'Delete roles',
  },
  {
    name: PERMISSIONS.PERMISSIONS_READ,
    resource: 'permissions',
    action: 'read',
    description: 'Read permissions',
  },
  {
    name: PERMISSIONS.PERMISSIONS_MANAGE,
    resource: 'permissions',
    action: 'manage',
    description: 'Manage permissions',
  },
  {
    name: PERMISSIONS.REPORTS_READ,
    resource: 'reports',
    action: 'read',
    description: 'Read reports',
  },
  {
    name: PERMISSIONS.DASHBOARD_READ,
    resource: 'dashboard',
    action: 'read',
    description: 'Read dashboard',
  },
];

async function upsertPermission(definition: (typeof permissionDefinitions)[number]): Promise<string> {
  const existing = await db.query.permissions.findFirst({
    where: eq(permissions.name, definition.name),
  });

  if (existing) {
    await db
      .update(permissions)
      .set({
        description: definition.description,
        resource: definition.resource,
        action: definition.action,
        updatedAt: new Date(),
      })
      .where(eq(permissions.id, existing.id));
    return existing.id;
  }

  const id = createId();
  const now = new Date();
  await db.insert(permissions).values({
    id,
    ...definition,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function upsertRole(
  name: string,
  description: string,
  permissionIds: string[],
): Promise<string> {
  const existing = await db.query.roles.findFirst({
    where: eq(roles.name, name),
  });

  let roleId: string;
  if (existing) {
    roleId = existing.id;
    await db
      .update(roles)
      .set({ description, updatedAt: new Date() })
      .where(eq(roles.id, roleId));
  } else {
    roleId = createId();
    const now = new Date();
    await db.insert(roles).values({
      id: roleId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionIds.length > 0) {
    await db.insert(rolePermissions).values(
      permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      })),
    );
  }

  return roleId;
}

async function main(): Promise<void> {
  const permissionIdsByName = new Map<string, string>();

  for (const definition of permissionDefinitions) {
    const id = await upsertPermission(definition);
    permissionIdsByName.set(definition.name, id);
  }

  const allPermissionIds = Array.from(permissionIdsByName.values());
  const userPermissionIds = [
    permissionIdsByName.get(PERMISSIONS.DASHBOARD_READ)!,
    permissionIdsByName.get(PERMISSIONS.REPORTS_READ)!,
  ];
  const adminPermissionIds = allPermissionIds.filter((id) => {
    const name = [...permissionIdsByName.entries()].find(([, value]) => value === id)?.[0];
    return name ? !name.startsWith('permissions:') : false;
  });

  const superAdminRoleId = await upsertRole(
    ROLES.SUPER_ADMIN,
    'Full system access',
    allPermissionIds,
  );
  await upsertRole(ROLES.ADMIN, 'Administrative access without permission management', adminPermissionIds);
  await upsertRole(ROLES.USER, 'Standard user access', userPermissionIds);

  const passwordHash = await bcrypt.hash('Admin@12345', 12);
  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, 'admin@devopsmentor.local'),
  });

  let adminId: string;
  if (existingAdmin) {
    adminId = existingAdmin.id;
    await db
      .update(users)
      .set({
        firstName: 'System',
        lastName: 'Admin',
        status: UserStatus.ACTIVE,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, adminId));
  } else {
    adminId = createId();
    const now = new Date();
    await db.insert(users).values({
      id: adminId,
      email: 'admin@devopsmentor.local',
      firstName: 'System',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.insert(userRoles).values({
    userId: adminId,
    roleId: superAdminRoleId,
  });

  // eslint-disable-next-line no-console
  console.log('Seed completed.');
  // eslint-disable-next-line no-console
  console.log('Admin login: admin@devopsmentor.local / Admin@12345');
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
