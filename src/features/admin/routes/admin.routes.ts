import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminAuditController } from '../controllers/admin-audit.controller';
import { adminDashboardController } from '../controllers/admin-dashboard.controller';
import { adminSettingsController } from '../controllers/admin-settings.controller';
import { adminUserController } from '../controllers/admin-user.controller';
import {
  adminUserIdParamSchema,
  adminUserListQuerySchema,
  auditLogQuerySchema,
  banUserSchema,
  inviteUserSchema,
  updateSettingSchema,
} from '../validators/admin.validator';

const adminRoutes = Router();

adminRoutes.use(authenticate);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List users with pagination and filters (ADM-01)
 */
adminRoutes.get(
  '/users',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_READ),
  validateRequest(adminUserListQuerySchema, 'query'),
  asyncHandler((req, res) => adminUserController.list(req, res)),
);

/**
 * @openapi
 * /admin/users/invite:
 *   post:
 *     tags: [Admin]
 *     summary: Invite users (individual learner or organization member)
 */
adminRoutes.post(
  '/users/invite',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE),
  validateRequest(inviteUserSchema, 'body'),
  asyncHandler((req, res) => adminUserController.invite(req, res)),
);

/**
 * @openapi
 * /admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Get full user detail (ADM-02)
 */
adminRoutes.get(
  '/users/:userId',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_READ),
  validateRequest(adminUserIdParamSchema, 'params'),
  asyncHandler((req, res) => adminUserController.detail(req, res)),
);

/**
 * @openapi
 * /admin/users/{userId}/ban:
 *   patch:
 *     tags: [Admin]
 *     summary: Ban a user (ADM-03)
 */
adminRoutes.patch(
  '/users/:userId/ban',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE),
  validateRequest(adminUserIdParamSchema, 'params'),
  validateRequest(banUserSchema),
  asyncHandler((req, res) => adminUserController.ban(req, res)),
);

/**
 * @openapi
 * /admin/users/{userId}/unban:
 *   patch:
 *     tags: [Admin]
 *     summary: Unban a user (ADM-04)
 */
adminRoutes.patch(
  '/users/:userId/unban',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE),
  validateRequest(adminUserIdParamSchema, 'params'),
  asyncHandler((req, res) => adminUserController.unban(req, res)),
);

/**
 * @openapi
 * /admin/users/{userId}:
 *   delete:
 *     tags: [Admin]
 *     summary: Soft-delete a user (ADM-05)
 */
adminRoutes.delete(
  '/users/:userId',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE),
  validateRequest(adminUserIdParamSchema, 'params'),
  asyncHandler((req, res) => adminUserController.delete(req, res)),
);

/**
 * @openapi
 * /admin/users/{userId}/restore:
 *   post:
 *     tags: [Admin]
 *     summary: Restore a soft-deleted user
 */
adminRoutes.post(
  '/users/:userId/restore',
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE),
  validateRequest(adminUserIdParamSchema, 'params'),
  asyncHandler((req, res) => adminUserController.restore(req, res)),
);

/**
 * @openapi
 * /admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Platform KPI dashboard (ADM-06)
 */
adminRoutes.get(
  '/dashboard',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  asyncHandler((req, res) => adminDashboardController.getKPIs(req, res)),
);

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     tags: [Admin]
 *     summary: List audit logs (ADM-07)
 */
adminRoutes.get(
  '/audit-logs',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(auditLogQuerySchema, 'query'),
  asyncHandler((req, res) => adminAuditController.list(req, res)),
);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: List system settings (ADM-08)
 */
adminRoutes.get(
  '/settings',
  authorizePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE),
  asyncHandler((req, res) => adminSettingsController.list(req, res)),
);

/**
 * @openapi
 * /admin/settings/{key}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a system setting (ADM-09)
 */
adminRoutes.patch(
  '/settings/:key',
  authorizePermissions(PERMISSIONS.PLATFORM_SETTINGS_MANAGE),
  validateRequest(updateSettingSchema),
  asyncHandler((req, res) => adminSettingsController.update(req, res)),
);

/**
 * @openapi
 * /admin/platform-admins:
 *   get:
 *     tags: [Admin]
 *     summary: List platform admins (ADM-10)
 */
adminRoutes.get(
  '/platform-admins',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_INVITE),
  asyncHandler((req, res) => adminUserController.listPlatformAdmins(req, res)),
);

export { adminRoutes };