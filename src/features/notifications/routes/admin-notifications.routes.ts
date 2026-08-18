import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminAnnouncementController } from '../controllers/admin-announcement.controller';
import {
  adminAnnouncementIdParamSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from '../validators/notifications.validator';

/**
 * F8 §07 route map OPS-21..OPS-23 (platform admin announcement publishing).
 * Every mutation writes an `audit_logs` row via AuditLogService.
 */
const adminNotificationsRouter = Router();

adminNotificationsRouter.use(authenticate);

/** Admin list surface: drafts + published + expired announcements. */
adminNotificationsRouter.get(
  '/announcements',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  asyncHandler((req, res) => adminAnnouncementController.list(req, res)),
);

/** OPS-21: POST /api/admin/announcements */
adminNotificationsRouter.post(
  '/announcements',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(createAnnouncementSchema),
  asyncHandler((req, res) => adminAnnouncementController.create(req, res)),
);

/** OPS-22: PATCH /api/admin/announcements/:id */
adminNotificationsRouter.patch(
  '/announcements/:id',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminAnnouncementIdParamSchema, 'params'),
  validateRequest(updateAnnouncementSchema),
  asyncHandler((req, res) => adminAnnouncementController.update(req, res)),
);

/** OPS-23: PATCH /api/admin/announcements/:id/publish */
adminNotificationsRouter.patch(
  '/announcements/:id/publish',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminAnnouncementIdParamSchema, 'params'),
  asyncHandler((req, res) => adminAnnouncementController.publish(req, res)),
);

export { adminNotificationsRouter };