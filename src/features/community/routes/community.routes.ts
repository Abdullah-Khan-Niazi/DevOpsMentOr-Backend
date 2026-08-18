import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { communityController } from '../controllers/community.controller';
import {
  commentIdParamSchema,
  createCommentSchema,
  createLikeSchema,
  createReportSchema,
  createReviewSchema,
  likeTargetParamSchema,
  listCommentsQuerySchema,
  listReviewsQuerySchema,
} from '../validators/community.validator';

/**
 * F8 §07 route map OPS-13..OPS-19 (learner + public community surfaces).
 * Reads are public; writes are authenticated, permission-gated and
 * rate-limited (abuse-prone surfaces).
 */
const communityRouter = Router();

/** OPS-13: public approved reviews. */
communityRouter.get(
  '/reviews',
  validateRequest(listReviewsQuerySchema, 'query'),
  asyncHandler((req, res) => communityController.listReviews(req, res)),
);

/** OPS-14: submit a review. */
communityRouter.post(
  '/reviews',
  authenticate,
  rateLimit({ scope: 'community-reviews', windowSeconds: 60, max: 10 }),
  authorizePermissions(PERMISSIONS.CONTENT_REVIEW_CREATE),
  validateRequest(createReviewSchema),
  asyncHandler((req, res) => communityController.createReview(req, res)),
);

/** OPS-15: public visible comments. */
communityRouter.get(
  '/comments',
  validateRequest(listCommentsQuerySchema, 'query'),
  asyncHandler((req, res) => communityController.listComments(req, res)),
);

/** OPS-16: create a comment. */
communityRouter.post(
  '/comments',
  authenticate,
  rateLimit({ scope: 'community-comments', windowSeconds: 60, max: 20 }),
  authorizePermissions(PERMISSIONS.CONTENT_COMMENT_CREATE),
  validateRequest(createCommentSchema),
  asyncHandler((req, res) => communityController.createComment(req, res)),
);

/** OPS-17: delete own comment. */
communityRouter.delete(
  '/comments/:id',
  authenticate,
  authorizePermissions(PERMISSIONS.CONTENT_COMMENT_CREATE),
  validateRequest(commentIdParamSchema, 'params'),
  asyncHandler((req, res) => communityController.deleteComment(req, res)),
);

/** OPS-18: like content (409 when already liked). */
communityRouter.post(
  '/likes',
  authenticate,
  rateLimit({ scope: 'community-likes', windowSeconds: 60, max: 60 }),
  authorizePermissions(PERMISSIONS.CONTENT_LIKE_CREATE),
  validateRequest(createLikeSchema),
  asyncHandler((req, res) => communityController.like(req, res)),
);

/** OPS-18 (unlike): `DELETE /api/likes/:targetType/:targetId`. */
communityRouter.delete(
  '/likes/:targetType/:targetId',
  authenticate,
  authorizePermissions(PERMISSIONS.CONTENT_LIKE_CREATE),
  validateRequest(likeTargetParamSchema, 'params'),
  asyncHandler((req, res) => communityController.unlike(req, res)),
);

/** OPS-19: file a report. */
communityRouter.post(
  '/reports',
  authenticate,
  rateLimit({ scope: 'community-reports', windowSeconds: 60, max: 10 }),
  authorizePermissions(PERMISSIONS.CONTENT_REPORT_CREATE),
  validateRequest(createReportSchema),
  asyncHandler((req, res) => communityController.createReport(req, res)),
);

export { communityRouter };