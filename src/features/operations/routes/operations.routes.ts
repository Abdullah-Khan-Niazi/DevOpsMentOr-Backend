import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  optionalAuthenticate,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { eventController } from '../controllers/event.controller';
import { getDownloadUrl } from '../controllers/file.controller';
import { handleFileServe } from '../services/file.service';
import {
  eventIdParamSchema,
  fileIdParamSchema,
  listEventsQuerySchema,
} from '../validators/operations.validator';

/**
 * F8 §07 route map OPS-09..12, OPS-20 (learner + public operations
 * surfaces). Event registration is rate-limited; the file serve endpoint
 * validates its HMAC signature and streams from disk.
 */
const operationsRouter = Router();

/** OPS-09: public event list. */
operationsRouter.get(
  '/events',
  optionalAuthenticate,
  validateRequest(listEventsQuerySchema, 'query'),
  asyncHandler((req, res) => eventController.listEvents(req, res)),
);

/** OPS-10: single public event. */
operationsRouter.get(
  '/events/:eventId',
  optionalAuthenticate,
  validateRequest(eventIdParamSchema, 'params'),
  asyncHandler((req, res) => eventController.getEvent(req, res)),
);

/** OPS-11: register (or waitlist) for an event. */
operationsRouter.post(
  '/events/:eventId/register',
  authenticate,
  rateLimit({ scope: 'event-registration', windowSeconds: 60, max: 10 }),
  authorizePermissions(PERMISSIONS.EVENTS_REGISTER),
  validateRequest(eventIdParamSchema, 'params'),
  asyncHandler((req, res) => eventController.register(req, res)),
);

/** OPS-12: cancel an event registration. */
operationsRouter.delete(
  '/events/:eventId/register',
  authenticate,
  authorizePermissions(PERMISSIONS.EVENTS_REGISTER),
  validateRequest(eventIdParamSchema, 'params'),
  asyncHandler((req, res) => eventController.cancelRegistration(req, res)),
);

/** Signed-URL file streaming (auth enforced at URL generation). */
operationsRouter.get(
  '/files/:fileId/serve',
  asyncHandler(async (req, res) => {
    await handleFileServe(req, res);
  }),
);

/** OPS-20: resolve a download URL for a file. */
operationsRouter.get(
  '/files/:fileId/download',
  authenticate,
  validateRequest(fileIdParamSchema, 'params'),
  asyncHandler((req, res) => getDownloadUrl(req, res)),
);

export { operationsRouter };