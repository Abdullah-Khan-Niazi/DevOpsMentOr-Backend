import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { analyticsController } from '../controllers/analytics.controller';
import { activityTrendQuerySchema } from '../validators/analytics.validator';

/**
 * F8 §07 route map OPS-41/42 (platform analytics), behind
 * `platform.analytics.read`. Responses contain anonymized aggregates only.
 */
const adminAnalyticsRouter = Router();

adminAnalyticsRouter.use(authenticate);

/** OPS-41: GET /api/admin/analytics/overview */
adminAnalyticsRouter.get(
  '/analytics/overview',
  authorizePermissions(PERMISSIONS.PLATFORM_ANALYTICS_READ),
  asyncHandler((req, res) => analyticsController.getOverview(req, res)),
);

/** OPS-42: GET /api/admin/analytics/activity?days=14 */
adminAnalyticsRouter.get(
  '/analytics/activity',
  authorizePermissions(PERMISSIONS.PLATFORM_ANALYTICS_READ),
  validateRequest(activityTrendQuerySchema, 'query'),
  asyncHandler((req, res) => analyticsController.getActivityTrend(req, res)),
);

/** Granular analytics: GET /api/admin/analytics/detailed */
adminAnalyticsRouter.get(
  '/analytics/detailed',
  authorizePermissions(PERMISSIONS.PLATFORM_ANALYTICS_READ),
  asyncHandler((req, res) => analyticsController.getDetailedAnalytics(req, res)),
);

export { adminAnalyticsRouter };