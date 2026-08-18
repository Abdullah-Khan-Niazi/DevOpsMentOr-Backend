import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  optionalAuthenticate,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { announcementController } from '../controllers/announcement.controller';
import { notificationController } from '../controllers/notification.controller';
import {
  announcementIdParamSchema,
  inboxQuerySchema,
  notificationIdParamSchema,
  updatePreferencesSchema,
} from '../validators/notifications.validator';

/**
 * F8 §07 route map OPS-01..OPS-08 (learner + public notification surfaces).
 * Identity is always session-derived; every row-level mutation is scoped to
 * `user_id = session.userId` in the service layer (AC-14 IDOR mitigation).
 */
const notificationsRouter = Router();

/** OPS-07: public published-announcement list. */
notificationsRouter.get(
  '/announcements',
  optionalAuthenticate,
  asyncHandler((req, res) => announcementController.listPublished(req, res)),
);

/** OPS-08: mark an announcement read. */
notificationsRouter.post(
  '/announcements/:id/read',
  authenticate,
  validateRequest(announcementIdParamSchema, 'params'),
  asyncHandler((req, res) => announcementController.markRead(req, res)),
);

const inboxRoutes = Router();
inboxRoutes.use('/notifications', authenticate);

/** OPS-01: paginated notification inbox. */
inboxRoutes.get(
  '/notifications',
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_INBOX_READ),
  validateRequest(inboxQuerySchema, 'query'),
  asyncHandler((req, res) => notificationController.listInbox(req, res)),
);

/** OPS-02: mark one notification read. */
inboxRoutes.patch(
  '/notifications/:id/read',
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_INBOX_READ),
  validateRequest(notificationIdParamSchema, 'params'),
  asyncHandler((req, res) => notificationController.markRead(req, res)),
);

/** OPS-03: mark all notifications read. */
inboxRoutes.patch(
  '/notifications/read-all',
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_INBOX_READ),
  asyncHandler((req, res) => notificationController.markAllRead(req, res)),
);

/** OPS-04: dismiss a notification. */
inboxRoutes.delete(
  '/notifications/:id',
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_INBOX_READ),
  validateRequest(notificationIdParamSchema, 'params'),
  asyncHandler((req, res) => notificationController.dismiss(req, res)),
);

/** OPS-05: read channel preferences. */
inboxRoutes.get(
  '/notifications/preferences',
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE),
  asyncHandler((req, res) => notificationController.getPreferences(req, res)),
);

/** OPS-06: upsert channel preferences (rate-limited: write surface). */
inboxRoutes.put(
  '/notifications/preferences',
  rateLimit({ scope: 'notification-preferences', windowSeconds: 60, max: 30 }),
  authorizePermissions(PERMISSIONS.NOTIFICATIONS_PREFERENCES_WRITE),
  validateRequest(updatePreferencesSchema),
  asyncHandler((req, res) => notificationController.updatePreferences(req, res)),
);

notificationsRouter.use(inboxRoutes);

export { notificationsRouter };