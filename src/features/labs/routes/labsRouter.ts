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
import { sherlockController } from '../controllers/SherlockController';
import { labStepController } from '../controllers/LabStepController';
import { aiMentorController } from '../controllers/AiMentorController';
import { trackController } from '../controllers/TrackController';
import {
  aiMentorMessageSchema,
  aiMentorQuerySchema,
  assignmentIdParamSchema,
  checkStepBodySchema,
  clearSessionSchema,
  emptyBodySchema,
  hintRevealParamSchema,
  instanceIdParamSchema,
  labIdParamSchema,
  provisionLabSchema,
  sherlockSubmitSchema,
  instanceStepParamSchema,
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
labsRouter.get('/tracks/default', asyncHandler((req, res) => trackController.getDefaultTrack(req, res)));
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
  rateLimit({ windowSeconds: 60, max: 10, scope: 'lab-provision', keyBy: 'user' }),
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

protectedRoutes.get(
  '/labs/:labId/steps',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => labStepController.getState(req, res)),
);

protectedRoutes.post(
  '/labs/instances/:instanceId/steps/:stepId/stage',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 20, scope: 'lab-step-stage', keyBy: 'user', failClosed: true }),
  validateRequest(instanceStepParamSchema, 'params'),
  validateRequest(emptyBodySchema, 'body'),
  asyncHandler((req, res) => labStepController.stage(req, res)),
);

protectedRoutes.post(
  '/labs/instances/:instanceId/steps/:stepId/check',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 20, scope: 'lab-step-check', keyBy: 'user', failClosed: true }),
  validateRequest(instanceStepParamSchema, 'params'),
  validateRequest(checkStepBodySchema, 'body'),
  asyncHandler((req, res) => labStepController.check(req, res)),
);

protectedRoutes.post(
  '/labs/:labId/steps/:stepId/hints/:hintIndex/reveal',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 10, scope: 'lab-hint', keyBy: 'user', failClosed: true }),
  validateRequest(hintRevealParamSchema, 'params'),
  validateRequest(emptyBodySchema, 'body'),
  asyncHandler((req, res) => labStepController.reveal(req, res)),
);

protectedRoutes.get(
  '/labs/:labId/slides',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'lab-slides', keyBy: 'user' }),
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => labStepController.slides(req, res)),
);

protectedRoutes.get(
  '/labs/:labId/walkthrough',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'lab-walkthrough', keyBy: 'user' }),
  validateRequest(labIdParamSchema, 'params'),
  asyncHandler((req, res) => labStepController.walkthrough(req, res)),
);

protectedRoutes.post(
  '/labs/:labId/sherlock/submit',
  authorizePermissions(PERMISSIONS.LABS_INSTANCE_READ),
  rateLimit({ windowSeconds: 60, max: 30, scope: 'sherlock-submit', keyBy: 'user', failClosed: true }),
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
  validateRequest(assignmentIdParamSchema, 'params'),
  asyncHandler((req, res) => vpnController.downloadOvpn(req, res)),
);

protectedRoutes.post(
  '/labs/ai-mentor/message',
  authorizePermissions(PERMISSIONS.LABS_AI_MENTOR_USE),
  rateLimit({ windowSeconds: env.AI_MENTOR_RATE_LIMIT_WINDOW_SECONDS, max: env.AI_MENTOR_RATE_LIMIT_MAX, scope: 'ai-mentor', keyBy: 'user' }),
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