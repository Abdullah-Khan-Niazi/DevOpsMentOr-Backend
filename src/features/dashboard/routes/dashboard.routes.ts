import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { dashboardController } from '../controllers/dashboard.controller';

const dashboardRoutes = Router();

dashboardRoutes.use(authenticate);

/**
 * @openapi
 * /dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard summary
 *     security:
 *       - bearerAuth: []
 */
dashboardRoutes.get(
  '/summary',
  authorizePermissions(PERMISSIONS.DASHBOARD_READ),
  asyncHandler((req, res) => dashboardController.getSummary(req, res)),
);

export { dashboardRoutes };
