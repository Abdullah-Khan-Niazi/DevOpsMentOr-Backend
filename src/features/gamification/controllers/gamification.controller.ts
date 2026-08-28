import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { achievementService } from '../services/achievement.service';
import { badgeService } from '../services/badge.service';
import { gamificationService } from '../services/gamification.service';
import { pointsService } from '../services/points.service';

/** F7 §08 HTTP handling for the learner gamification profile and catalogs. */
export class GamificationController {
  /** GAM-01 */
  async getMyProfile(req: Request, res: Response): Promise<Response> {
    const profile = await gamificationService.getMyProfile(Number(req.user?.sub));
    return sendSuccess(res, profile, 'Gamification profile retrieved successfully.');
  }

  /** GAM-02 */
  async listBadges(_req: Request, res: Response): Promise<Response> {
    const badges = await badgeService.listBadges();
    return sendSuccess(res, badges, 'Badges retrieved successfully.');
  }

  /** GAM-03 */
  async getBadgeDetail(req: Request, res: Response): Promise<Response> {
    const badge = await badgeService.getBadgeDetail(Number(req.params.badgeId));
    return sendSuccess(res, badge, 'Badge retrieved successfully.');
  }

  /** GAM-04 */
  async listAchievements(_req: Request, res: Response): Promise<Response> {
    const achievements = await achievementService.listAchievements();
    return sendSuccess(res, achievements, 'Achievements retrieved successfully.');
  }

  /** GAM-05 */
  async getPointsHistory(req: Request, res: Response): Promise<Response> {
    const history = await pointsService.getHistory(
      Number(req.user?.sub),
      Number(req.query.page ?? 1),
      Number(req.query.limit ?? 25),
    );
    return sendSuccess(res, history, 'Points history retrieved successfully.');
  }
}

export const gamificationController = new GamificationController();