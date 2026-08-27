import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions } from '../../../shared/middleware';
import { asyncHandler, sendSuccess } from '../../../shared/utils';
import { userService } from '../services/user.service';

/**
 * Forward hook (F2 §02): aggregate learner-pool stats for F8/F9 consumers.
 */
const platformRoutes = Router();

platformRoutes.get(
  '/learner-pool/stats',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_USERS_READ),
  asyncHandler(async (_req, res) => {
    const stats = await userService.getLearnerPoolStats();
    return sendSuccess(res, stats, 'Learner pool stats retrieved successfully.');
  }),
);

export { platformRoutes };