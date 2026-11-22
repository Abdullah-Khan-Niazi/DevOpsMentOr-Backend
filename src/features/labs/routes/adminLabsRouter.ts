import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizeAnyPermissions,
  authorizePermissions,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminLabController } from '../controllers/AdminLabController';
import {
  adminTerminateBodySchema,
  catalogQuerySchema,
  createLabSchema,
  createTrackSchema,
  importCatalogLabSchema,
  instanceIdParamSchema,
  labIdParamSchema,
  labInstancesQuerySchema,
  publishLabSchema,
  saveLabSpecSchema,
  testCheckSchema,
  trackContentAttachSchema,
  trackContentParamSchema,
  trackContentPatchSchema,
  trackContentReorderSchema,
  trackIdParamSchema,
  updateLabSchema,
  updateTrackSchema,
  validateLabSpecSchema,
} from '../validators/labs.validator';

/**
 * F6 §08 admin lab/track surface (contracts 6.2). `platform.labs.manage`
 * covers catalog CRUD; `platform.labs.admin` covers the instance monitor
 * (LAB-21/22). Literal paths are registered before their `/:id` siblings.
 */
const adminLabsRouter = Router();

adminLabsRouter.use(authenticate);

/* ── Labs ─────────────────────────────────────────────────────────────── */

adminLabsRouter.get(
  '/labs',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  asyncHandler((req, res) => adminLabController.listLabs(req, res)),
);

adminLabsRouter.get(
  '/labs/catalog',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'admin-lab-catalog', keyBy: 'user' }),
  validateRequest(catalogQuerySchema, 'query'),
  asyncHandler((req, res) => adminLabController.catalog(req, res)),
);

adminLabsRouter.post(
  '/labs/import',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  rateLimit({ windowSeconds: 60, max: 10, scope: 'admin-lab-import', keyBy: 'user' }),
  validateRequest(importCatalogLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.importLab(req, res)),
);

adminLabsRouter.post(
  '/labs/spec/validate',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(validateLabSpecSchema, 'body'),
  asyncHandler((req, res) => adminLabController.validateSpec(req, res)),
);

adminLabsRouter.post(
  '/labs',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(createLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.createLab(req, res)),
);

adminLabsRouter.get(
  '/labs/:labId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => adminLabController.getLab(req, res)),
);

adminLabsRouter.patch(
  '/labs/:labId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(updateLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.updateLab(req, res)),
);

adminLabsRouter.put(
  '/labs/:labId/spec',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(saveLabSpecSchema, 'body'),
  asyncHandler((req, res) => adminLabController.saveSpec(req, res)),
);

adminLabsRouter.patch(
  '/labs/:labId/publish',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(publishLabSchema, 'body'),
  asyncHandler((req, res) => adminLabController.publishLab(req, res)),
);

adminLabsRouter.delete(
  '/labs/:labId',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => adminLabController.deleteLab(req, res)),
);

adminLabsRouter.post(
  '/labs/:labId/test-check',
  authorizePermissions(PERMISSIONS.PLATFORM_LABS_MANAGE),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'admin-lab-test-check', keyBy: 'user', failClosed: true }),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(testCheckSchema, 'body'),
  asyncHandler((req, res) => adminLabController.testCheck(req, res)),
);

/* ── Tracks ───────────────────────────────────────────────────────────── */

const trackRead = authorizeAnyPermissions(
  PERMISSIONS.PLATFORM_CURRICULUM_READ,
  PERMISSIONS.PLATFORM_LABS_MANAGE,
);
const trackWrite = authorizeAnyPermissions(
  PERMISSIONS.PLATFORM_CURRICULUM_MANAGE,
  PERMISSIONS.PLATFORM_LABS_MANAGE,
);

adminLabsRouter.get(
  '/tracks',
  trackRead,
  asyncHandler((req, res) => adminLabController.listTracks(req, res)),
);

adminLabsRouter.post(
  '/tracks',
  trackWrite,
  validateRequest(createTrackSchema, 'body'),
  asyncHandler((req, res) => adminLabController.createTrack(req, res)),
);

adminLabsRouter.get(
  '/tracks/:trackId',
  trackRead,
  validateRequest(trackIdParamSchema, 'params'),
  asyncHandler((req, res) => adminLabController.getTrack(req, res)),
);

adminLabsRouter.patch(
  '/tracks/:trackId',
  trackWrite,
  validateRequest(trackIdParamSchema, 'params'),
  validateRequest(updateTrackSchema, 'body'),
  asyncHandler((req, res) => adminLabController.updateTrack(req, res)),
);

adminLabsRouter.post(
  '/tracks/:trackId/content',
  trackWrite,
  validateRequest(trackIdParamSchema, 'params'),
  validateRequest(trackContentAttachSchema, 'body'),
  asyncHandler((req, res) => adminLabController.attachTrackContent(req, res)),
);

// Literal `/content/reorder` before `/content/:courseId`.
adminLabsRouter.patch(
  '/tracks/:trackId/content/reorder',
  trackWrite,
  validateRequest(trackIdParamSchema, 'params'),
  validateRequest(trackContentReorderSchema, 'body'),
  asyncHandler((req, res) => adminLabController.reorderTrackContent(req, res)),
);

adminLabsRouter.patch(
  '/tracks/:trackId/content/:courseId',
  trackWrite,
  validateRequest(trackContentParamSchema, 'params'),
  validateRequest(trackContentPatchSchema, 'body'),
  asyncHandler((req, res) => adminLabController.updateTrackContent(req, res)),
);

adminLabsRouter.delete(
  '/tracks/:trackId/content/:courseId',
  trackWrite,
  validateRequest(trackContentParamSchema, 'params'),
  asyncHandler((req, res) => adminLabController.detachTrackContent(req, res)),
);

/* ── Instances ────────────────────────────────────────────────────────── */

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
