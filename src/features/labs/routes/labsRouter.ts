import { Router } from 'express';
import { env } from '../../../app/config';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  optionalAuthenticate,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { labController, vpnController } from '../controllers/LabController';
import { assertionController, sherlockController } from '../controllers/AssertionController';
import { aiMentorController } from '../controllers/AiMentorController';
import { trackController } from '../controllers/TrackController';
import {
  aiMentorMessageSchema,
  aiMentorQuerySchema,
  clearSessionSchema,
  instanceIdParamSchema,
  labIdParamSchema,
  provisionLabSchema,
  sherlockSubmitSchema,
  trackIdParamSchema,
  vpnConfigQuerySchema,
} from '../validators/labs.validator';

/** F6 §08 learner-facing lab surface. */
const labsRouter = Router();

/** Public catalog: preview without auth; `isStarted` resolved when signed in. */
labsRouter.get('/labs', asyncHandler((req, res) => labController.listLabs(req, res)));
labsRouter.get(
  '/labs/:labId',
  optionalAuthenticate,
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => labController.getLabDetail(req, res)),
);

/** Public track catalog. */
labsRouter.get('/tracks', asyncHandler((req, res) => trackController.listTracks(req, res)));
labsRouter.get(
  '/tracks/:trackId',
  optionalAuthenticate,
  validateRequest(trackIdParamSchema, 'params'),
  asyncHandler((req, res) => trackController.getTrackDetail(req, res)),
);

/** Authenticated + permission-gated learner surface. */
const protectedRoutes = Router();
protectedRoutes.use(authenticate);

protectedRoutes.post(
  '/labs/:labId/instances',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_CREATE),
  rateLimit({ windowSeconds: 60, max: 10, scope: 'lab-provision' }),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(provisionLabSchema, 'body'),
  asyncHandler((req, res) => labController.provisionInstance(req, res)),
);

protectedRoutes.get(
  '/labs/instances/active',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  asyncHandler((req, res) => labController.getActiveInstance(req, res)),
);

protectedRoutes.patch(
  '/labs/instances/:instanceId/stop',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_DELETE),
  validateRequest(instanceIdParamSchema, 'params'),
  asyncHandler((req, res) => labController.stopInstance(req, res)),
);

protectedRoutes.delete(
  '/labs/instances/:instanceId',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_DELETE),
  validateRequest(instanceIdParamSchema, 'params'),
  asyncHandler((req, res) => labController.terminateInstance(req, res)),
);

protectedRoutes.patch(
  '/labs/instances/:instanceId/extend',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_CREATE),
  validateRequest(instanceIdParamSchema, 'params'),
  asyncHandler((req, res) => labController.extendInstance(req, res)),
);

protectedRoutes.post(
  '/labs/instances/:instanceId/assert',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  validateRequest(instanceIdParamSchema, 'params'),
  asyncHandler((req, res) => assertionController.runChecks(req, res)),
);

protectedRoutes.post(
  '/labs/:labId/sherlock/submit',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'sherlock-submit' }),
  validateRequest(labIdParamSchema, 'params'),
  validateRequest(sherlockSubmitSchema, 'body'),
  asyncHandler((req, res) => sherlockController.submitAnswers(req, res)),
);

protectedRoutes.get(
  '/labs/vpn/config',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  validateRequest(vpnConfigQuerySchema, 'query'),
  asyncHandler((req, res) => vpnController.getConfig(req, res)),
);

protectedRoutes.get(
  '/labs/vpn/ovpn/:assignmentId',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  validateRequest(instanceIdParamSchema, 'params'),
  asyncHandler((req, res) => vpnController.downloadOvpn(req, res)),
);

protectedRoutes.post(
  '/labs/ai-mentor/message',
  authorizePermissions(PERMISSIONS.LABS_AI_MENTOR_USE),
  rateLimit({ windowSeconds: env.AI_MENTOR_RATE_LIMIT_WINDOW_SECONDS, max: env.AI_MENTOR_RATE_LIMIT_MAX, scope: 'ai-mentor' }),
  validateRequest(aiMentorMessageSchema, 'body'),
  asyncHandler((req, res) => aiMentorController.sendMessage(req, res)),
);

protectedRoutes.get(
  '/labs/ai-mentor/session',
  authorizePermissions(PERMISSIONS.LABS_AI_MENTOR_USE),
  validateRequest(aiMentorQuerySchema, 'query'),
  asyncHandler((req, res) => aiMentorController.getSession(req, res)),
);

protectedRoutes.delete(
  '/labs/ai-mentor/session',
  authorizePermissions(PERMISSIONS.LABS_AI_MENTOR_USE),
  validateRequest(clearSessionSchema, 'body'),
  asyncHandler((req, res) => aiMentorController.clearSession(req, res)),
);

protectedRoutes.get(
  '/tracks/:trackId/progress',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  validateRequest(trackIdParamSchema, 'params'),
  asyncHandler((req, res) => trackController.getTrackProgress(req, res)),
);

labsRouter.use(protectedRoutes);

export { labsRouter };