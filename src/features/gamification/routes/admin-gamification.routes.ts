import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminGamificationController } from '../controllers/admin-gamification.controller';
import {
  achievementIdParamSchema,
  badgeIdParamSchema,
  certIdParamSchema,
  createAchievementSchema,
  createBadgeSchema,
  createSeasonSchema,
  pointsAdjustSchema,
  seasonIdParamSchema,
  updateAchievementSchema,
  updateBadgeSchema,
  updateSeasonSchema,
} from '../validators/gamification.validator';

/**
 * F7 §07 admin route map: GAM-15..GAM-23, mounted under `/admin`.
 * Every route is gated by `platform.gamification.manage` (SCR-F7-07).
 */
const adminGamificationRouter = Router();

adminGamificationRouter.use(authorizePermissions(PERMISSIONS.PLATFORM_GAMIFICATION_MANAGE));

/** GAM-15 */
adminGamificationRouter.post(
  '/badges',
  validateRequest(createBadgeSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.createBadge(req, res)),
);

/** GAM-16 */
adminGamificationRouter.patch(
  '/badges/:badgeId',
  validateRequest(badgeIdParamSchema, 'params'),
  validateRequest(updateBadgeSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.updateBadge(req, res)),
);

/** Admin badge catalog (includes hidden badges). */
adminGamificationRouter.get(
  '/badges',
  asyncHandler((req, res) => adminGamificationController.listBadges(req, res)),
);

/** GAM-17 */
adminGamificationRouter.post(
  '/achievements',
  validateRequest(createAchievementSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.createAchievement(req, res)),
);

/** GAM-18 */
adminGamificationRouter.patch(
  '/achievements/:achievementId',
  validateRequest(achievementIdParamSchema, 'params'),
  validateRequest(updateAchievementSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.updateAchievement(req, res)),
);

/** Admin achievement catalog (includes inactive). */
adminGamificationRouter.get(
  '/achievements',
  asyncHandler((req, res) => adminGamificationController.listAchievements(req, res)),
);

/** GAM-19 */
adminGamificationRouter.post(
  '/seasons',
  validateRequest(createSeasonSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.createSeason(req, res)),
);

/** GAM-20 */
adminGamificationRouter.patch(
  '/seasons/:seasonId',
  validateRequest(seasonIdParamSchema, 'params'),
  validateRequest(updateSeasonSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.updateSeason(req, res)),
);

/** GAM-21 */
adminGamificationRouter.post(
  '/gamification/points/adjust',
  validateRequest(pointsAdjustSchema, 'body'),
  asyncHandler((req, res) => adminGamificationController.adjustPoints(req, res)),
);

/** GAM-22 */
adminGamificationRouter.patch(
  '/certificates/:certId/invalidate',
  validateRequest(certIdParamSchema, 'params'),
  asyncHandler((req, res) => adminGamificationController.invalidateCertificate(req, res)),
);

/** GAM-23 */
adminGamificationRouter.post(
  '/leaderboard/recompute',
  asyncHandler((req, res) => adminGamificationController.recomputeLeaderboard(req, res)),
);

export { adminGamificationRouter };