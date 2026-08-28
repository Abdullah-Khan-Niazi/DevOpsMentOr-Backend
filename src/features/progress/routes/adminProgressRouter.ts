import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { progressController } from '../controllers/ProgressController';
import { userIdParamSchema } from '../validators/progress.validator';

/** F5-API-12: platform-admin cross-user progress read (§04 scope: none). */
const adminProgressRouter = Router();

adminProgressRouter.use(authenticate);

adminProgressRouter.get(
  '/progress/:userId',
  authorizePermissions(PERMISSIONS.PLATFORM_PROGRESS_READ),
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getAdminUserProgress(req, res)),
);

export { adminProgressRouter };
