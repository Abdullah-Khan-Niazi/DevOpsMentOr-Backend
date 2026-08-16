import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { leaderboardComputationJob } from '../jobs/leaderboard-computation.job';
import { adminAchievementService } from '../services/admin-achievement.service';
import { adminBadgeService } from '../services/admin-badge.service';
import { adminCertificateService } from '../services/admin-certificate.service';
import { adminPointsService } from '../services/admin-points.service';
import { adminSeasonService } from '../services/admin-season.service';
import { badgeService } from '../services/badge.service';
import { achievementService } from '../services/achievement.service';

/** F7 §08 HTTP handling for platform-admin gamification management. */
export class AdminGamificationController {
  /** GAM-15 */
  async createBadge(req: Request, res: Response): Promise<Response> {
    const badge = await adminBadgeService.create(req.body);
    return sendSuccess(res, badge, 'Badge created successfully.', 201);
  }

  /** GAM-16 */
  async updateBadge(req: Request, res: Response): Promise<Response> {
    const badge = await adminBadgeService.update(Number(req.params.badgeId), req.body);
    return sendSuccess(res, badge, 'Badge updated successfully.');
  }

  /** GAM-17 */
  async createAchievement(req: Request, res: Response): Promise<Response> {
    const achievement = await adminAchievementService.create(req.body);
    return sendSuccess(res, achievement, 'Achievement created successfully.', 201);
  }

  /** GAM-18 */
  async updateAchievement(req: Request, res: Response): Promise<Response> {
    const achievement = await adminAchievementService.update(
      Number(req.params.achievementId),
      req.body,
    );
    return sendSuccess(res, achievement, 'Achievement updated successfully.');
  }

  /** GAM-19 */
  async createSeason(req: Request, res: Response): Promise<Response> {
    const season = await adminSeasonService.create(req.body);
    return sendSuccess(res, season, 'Season created successfully.', 201);
  }

  /** GAM-20 */
  async updateSeason(req: Request, res: Response): Promise<Response> {
    const season = await adminSeasonService.update(Number(req.params.seasonId), req.body);
    return sendSuccess(res, season, 'Season updated successfully.');
  }

  /** GAM-21 */
  async adjustPoints(req: Request, res: Response): Promise<Response> {
    const result = await adminPointsService.adjust(
      req.body.targetUserId,
      req.body.pointsChange,
      req.body.description,
    );
    return sendSuccess(res, result, 'Points adjustment recorded.', 201);
  }

  /** GAM-22 */
  async invalidateCertificate(req: Request, res: Response): Promise<Response> {
    const certificate = await adminCertificateService.invalidate(Number(req.params.certId));
    return sendSuccess(res, certificate, 'Certificate invalidated.');
  }

  /** GAM-23 */
  async recomputeLeaderboard(_req: Request, res: Response): Promise<Response> {
    const result = await leaderboardComputationJob.triggerManual();
    return sendSuccess(res, result, 'Leaderboard recomputed successfully.');
  }

  /** Admin badge catalog read (includes hidden badges). */
  async listBadges(_req: Request, res: Response): Promise<Response> {
    const badges = await badgeService.listBadgesForAdmin();
    return sendSuccess(res, badges, 'Badges retrieved successfully.');
  }

  /** Admin achievement catalog read (includes inactive). */
  async listAchievements(_req: Request, res: Response): Promise<Response> {
    const achievements = await achievementService.listAchievementsForAdmin();
    return sendSuccess(res, achievements, 'Achievements retrieved successfully.');
  }
}

export const adminGamificationController = new AdminGamificationController();