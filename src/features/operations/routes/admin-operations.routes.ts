import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminEventController } from '../controllers/admin-event.controller';
import { emailTemplateController } from '../controllers/email-template.controller';
import { listFiles, uploadFile } from '../controllers/file.controller';
import { singlePlatformFileUpload } from '../controllers/file.controller';
import {
  attendeesQuerySchema,
  createEventSchema,
  eventIdParamSchema,
  templateIdParamSchema,
  updateEmailTemplateSchema,
  updateEventSchema,
  uploadFileQuerySchema,
} from '../validators/operations.validator';

/**
 * F8 §07 route map OPS-24..26, OPS-35..37, OPS-43/44 (platform admin
 * operations). Every mutation writes an audit row.
 */
const adminOperationsRouter = Router();

adminOperationsRouter.use(authenticate);

/** OPS-24: POST /api/admin/events */
adminOperationsRouter.post(
  '/events',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(createEventSchema),
  asyncHandler((req, res) => adminEventController.create(req, res)),
);

/** OPS-25: PATCH /api/admin/events/:id */
adminOperationsRouter.patch(
  '/events/:eventId',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(eventIdParamSchema, 'params'),
  validateRequest(updateEventSchema),
  asyncHandler((req, res) => adminEventController.update(req, res)),
);

/** OPS-26: GET /api/admin/events/:id/attendees */
adminOperationsRouter.get(
  '/events/:eventId/attendees',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(eventIdParamSchema, 'params'),
  validateRequest(attendeesQuerySchema, 'query'),
  asyncHandler((req, res) => adminEventController.listAttendees(req, res)),
);

/** OPS-35: GET /api/admin/email-templates */
adminOperationsRouter.get(
  '/email-templates',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  asyncHandler((req, res) => emailTemplateController.list(req, res)),
);

/** OPS-36: PATCH /api/admin/email-templates/:id */
adminOperationsRouter.patch(
  '/email-templates/:id',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(templateIdParamSchema, 'params'),
  validateRequest(updateEmailTemplateSchema),
  asyncHandler((req, res) => emailTemplateController.update(req, res)),
);

/** OPS-37: POST /api/admin/email-templates/:id/preview */
adminOperationsRouter.post(
  '/email-templates/:id/preview',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  validateRequest(templateIdParamSchema, 'params'),
  asyncHandler((req, res) => emailTemplateController.preview(req, res)),
);

/** OPS-43: POST /api/admin/files (multipart upload). */
adminOperationsRouter.post(
  '/files',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  rateLimit({ scope: 'admin-file-upload', windowSeconds: 60, max: 20 }),
  validateRequest(uploadFileQuerySchema, 'query'),
  singlePlatformFileUpload(),
  asyncHandler(uploadFile),
);

/** OPS-44: GET /api/admin/files */
adminOperationsRouter.get(
  '/files',
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_ACCESS),
  asyncHandler(listFiles),
);

export { adminOperationsRouter };