import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizeAnyPermissions,
  authorizePermissions,
  optionalAuthenticate,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { certificateController } from '../controllers/certificate.controller';
import { gamificationController } from '../controllers/gamification.controller';
import { leaderboardController } from '../controllers/leaderboard.controller';
import {
  badgeIdParamSchema,
  certificateNumberParamSchema,
  certIdParamSchema,
  classIdParamSchema,
  countryCodeParamSchema,
  orgIdParamSchema,
  paginationQuerySchema,
  seasonIdParamSchema,
} from '../validators/gamification.validator';

/** F7 §07 route map: GAM-01..GAM-14 (learner + public surfaces). */
const gamificationRouter = Router();

/** ── Public surfaces (no identity required) ───────────────────────────── */

gamificationRouter.get(
  '/leaderboard/global',
  optionalAuthenticate,
  validateRequest(paginationQuerySchema, 'query'),
  asyncHandler((req, res) => leaderboardController.getGlobal(req, res)),
);

gamificationRouter.get(
  '/leaderboard/country/:countryCode',
  optionalAuthenticate,
  validateRequest(countryCodeParamSchema, 'params'),
  validateRequest(paginationQuerySchema, 'query'),
  asyncHandler((req, res) => leaderboardController.getByCountry(req, res)),
);

gamificationRouter.get(
  '/leaderboard/season/:seasonId',
  optionalAuthenticate,
  validateRequest(seasonIdParamSchema, 'params'),
  validateRequest(paginationQuerySchema, 'query'),
  asyncHandler((req, res) => leaderboardController.getSeason(req, res)),
);

gamificationRouter.get(
  '/certificates/verify/:certNumber',
  validateRequest(certificateNumberParamSchema, 'params'),
  asyncHandler((req, res) => certificateController.verify(req, res)),
);

gamificationRouter.get('/seasons', asyncHandler((req, res) => leaderboardController.listSeasons(req, res)));

gamificationRouter.get(
  '/seasons/:seasonId',
  validateRequest(seasonIdParamSchema, 'params'),
  asyncHandler((req, res) => leaderboardController.getSeasonDetail(req, res)),
);

/** ── Authenticated learner surfaces ───────────────────────────────────── */

const learnerRoutes = Router();
learnerRoutes.use(authenticate);

/** GAM-01 */
learnerRoutes.get(
  '/gamification/me',
  authorizePermissions(PERMISSIONS.GAMIFICATION_PROFILE_READ),
  asyncHandler((req, res) => gamificationController.getMyProfile(req, res)),
);

/** GAM-02 */
learnerRoutes.get(
  '/gamification/badges',
  authorizePermissions(PERMISSIONS.GAMIFICATION_PROFILE_READ),
  asyncHandler((req, res) => gamificationController.listBadges(req, res)),
);

/** GAM-03 */
learnerRoutes.get(
  '/gamification/badges/:badgeId',
  authorizePermissions(PERMISSIONS.GAMIFICATION_PROFILE_READ),
  validateRequest(badgeIdParamSchema, 'params'),
  asyncHandler((req, res) => gamificationController.getBadgeDetail(req, res)),
);

/** GAM-04 */
learnerRoutes.get(
  '/gamification/achievements',
  authorizePermissions(PERMISSIONS.GAMIFICATION_PROFILE_READ),
  asyncHandler((req, res) => gamificationController.listAchievements(req, res)),
);

/** GAM-05 */
learnerRoutes.get(
  '/gamification/points/history',
  authorizePermissions(PERMISSIONS.GAMIFICATION_PROFILE_READ),
  validateRequest(paginationQuerySchema, 'query'),
  asyncHandler((req, res) => gamificationController.getPointsHistory(req, res)),
);

/** GAM-13 */
learnerRoutes.get(
  '/certificates/:certId/download',
  authorizePermissions(PERMISSIONS.GAMIFICATION_CERTIFICATE_DOWNLOAD),
  validateRequest(certIdParamSchema, 'params'),
  asyncHandler((req, res) => certificateController.getDownloadUrl(req, res)),
);

/** GAM-09 */
learnerRoutes.get(
  '/leaderboard/class/:classId',
  authorizeAnyPermissions(
    PERMISSIONS.GAMIFICATION_CLASS_READ,
    PERMISSIONS.GAMIFICATION_ORG_READ,
    PERMISSIONS.PLATFORM_GAMIFICATION_MANAGE,
  ),
  validateRequest(classIdParamSchema, 'params'),
  asyncHandler((req, res) => leaderboardController.getClass(req, res)),
);

/** GAM-10 */
learnerRoutes.get(
  '/leaderboard/org/:orgId',
  authorizeAnyPermissions(
    PERMISSIONS.GAMIFICATION_ORG_READ,
    PERMISSIONS.PLATFORM_GAMIFICATION_MANAGE,
  ),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => leaderboardController.getOrg(req, res)),
);

gamificationRouter.use(learnerRoutes);

export { gamificationRouter };