import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { progressController } from '../controllers/ProgressController';
import { staffCourseQuerySchema, userIdParamSchema } from '../validators/progress.validator';

/** F5-API-12: platform-admin cross-user progress read (§04 scope: none). */
const adminProgressRouter = Router();

adminProgressRouter.use(authenticate);

adminProgressRouter.get(
  '/users/:userId/progress',
  authorizePermissions(PERMISSIONS.PLATFORM_PROGRESS_READ),
  validateRequest(userIdParamSchema, 'params'),
  validateRequest(staffCourseQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getAdminUserProgress(req, res)),
);

export { adminProgressRouter };
