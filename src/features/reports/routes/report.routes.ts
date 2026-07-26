import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { reportController } from '../controllers/report.controller';

const reportRoutes = Router();

reportRoutes.use(authenticate);

/**
 * @openapi
 * /reports/users:
 *   get:
 *     tags: [Reports]
 *     summary: Get users report
 *     security:
 *       - bearerAuth: []
 */
reportRoutes.get(
  '/users',
  authorizePermissions(PERMISSIONS.REPORTS_READ),
  asyncHandler((req, res) => reportController.getUsersReport(req, res)),
);

export { reportRoutes };
