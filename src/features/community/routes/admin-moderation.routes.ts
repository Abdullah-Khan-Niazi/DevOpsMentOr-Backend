import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminModerationController } from '../controllers/admin-moderation.controller';
import {
  adminCommentIdParamSchema,
  adminCommentsQuerySchema,
  adminReportIdParamSchema,
  adminReportsQuerySchema,
  adminReviewIdParamSchema,
  adminReviewsQuerySchema,
} from '../validators/community.validator';

/**
 * F8 §07 route map OPS-27..OPS-34 (platform admin moderation), all behind
 * `platform.content.moderate`. Every mutation writes an audit row.
 */
const adminModerationRouter = Router();

adminModerationRouter.use(authenticate);

/** OPS-27: GET /api/admin/reviews */
adminModerationRouter.get(
  '/reviews',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReviewsQuerySchema, 'query'),
  asyncHandler((req, res) => adminModerationController.listReviews(req, res)),
);

/** OPS-28: PATCH /api/admin/reviews/:id/approve */
adminModerationRouter.patch(
  '/reviews/:id/approve',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReviewIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.approveReview(req, res)),
);

/** OPS-29: DELETE /api/admin/reviews/:id */
adminModerationRouter.delete(
  '/reviews/:id',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReviewIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.deleteReview(req, res)),
);

/** Additive: GET /api/admin/comments (browse surface for OPS-30/31). */
adminModerationRouter.get(
  '/comments',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminCommentsQuerySchema, 'query'),
  asyncHandler((req, res) => adminModerationController.listComments(req, res)),
);

/** OPS-30: PATCH /api/admin/comments/:id/pin */
adminModerationRouter.patch(
  '/comments/:id/pin',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminCommentIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.pinComment(req, res)),
);

/** OPS-31: PATCH /api/admin/comments/:id/hide */
adminModerationRouter.patch(
  '/comments/:id/hide',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminCommentIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.hideComment(req, res)),
);

/** OPS-32: GET /api/admin/reports */
adminModerationRouter.get(
  '/reports',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReportsQuerySchema, 'query'),
  asyncHandler((req, res) => adminModerationController.listQueue(req, res)),
);

/** OPS-33: PATCH /api/admin/reports/:id/resolve */
adminModerationRouter.patch(
  '/reports/:id/resolve',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReportIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.resolveReport(req, res)),
);

/** OPS-34: PATCH /api/admin/reports/:id/dismiss */
adminModerationRouter.patch(
  '/reports/:id/dismiss',
  authorizePermissions(PERMISSIONS.PLATFORM_CONTENT_MODERATE),
  validateRequest(adminReportIdParamSchema, 'params'),
  asyncHandler((req, res) => adminModerationController.dismissReport(req, res)),
);

export { adminModerationRouter };