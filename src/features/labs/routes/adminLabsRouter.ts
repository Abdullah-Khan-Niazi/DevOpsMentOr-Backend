import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminLabController } from '../controllers/AdminLabController';
import {
  adminTerminateBodySchema,
  createLabSchema,
  createTrackSchema,
  instanceIdParamSchema,
  labIdParamSchema,
  labInstancesQuerySchema,
  publishLabSchema,
  trackIdParamSchema,
  updateLabSchema,
  updateTrackSchema,
} from '../validators/labs.validator';

/**
 * F6 §08 admin lab/track surface. `platform.labs.manage` covers catalog
 * CRUD; `platform.labs.admin` covers the instance monitor (LAB-21/22).
 */
const adminLabsRouter = Router();

adminLabsRouter.use(authenticate);

adminLabsRouter.post(
  '/labs',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(createLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.createLab(req, res)),
);

adminLabsRouter.patch(
  '/labs/:labId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(updateLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.updateLab(req, res)),
);

adminLabsRouter.patch(
  '/labs/:labId/publish',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(publishLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.publishLab(req, res)),
);

adminLabsRouter.post(
  '/tracks',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(createTrackSchema, 'body'),
  asyncHandler((req, res) => adminLabController.createTrack(req, res)),
);

adminLabsRouter.patch(
  '/tracks/:trackId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(trackIdParamSchema, 'params'),
  validateRequest(updateTrackSchema, 'body'),
  asyncHandler((req, res) => adminLabController.updateTrack(req, res)),
);

adminLabsRouter.get(
  '/lab-instances',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_ADMIN),
  validateRequest(labInstancesQuerySchema, 'query'),
  asyncHandler((req, res) => adminLabController.listInstances(req, res)),
);

adminLabsRouter.delete(
  '/lab-instances/:instanceId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_ADMIN),
  validateRequest(instanceIdParamSchema, 'params'),
  validateRequest(adminTerminateBodySchema, 'body'),
  asyncHandler((req, res) => adminLabController.terminateInstance(req, res)),
);

export { adminLabsRouter };