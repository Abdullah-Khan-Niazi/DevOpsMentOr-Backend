import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { GamificationActor } from '../services/leaderboard.service';
import { leaderboardService } from '../services/leaderboard.service';
import { seasonService } from '../services/season.service';

function actorFrom(req: Request): GamificationActor {
  return {
    userId: Number(req.user?.sub),
    roles: req.user?.roles ?? [],
    permissions: req.user?.permissions ?? [],
  };
}

function viewerUserId(req: Request): number | null {
  const sub = req.user?.sub;
  return sub ? Number(sub) : null;
}

function pageInfo(req: Request): { page: number; limit: number } {
  return { page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 25) };
}

/** F7 §08 HTTP handling for global, country, season, class and org leaderboards. */
export class LeaderboardController {
  /** GAM-06 */
  async getGlobal(req: Request, res: Response): Promise<Response> {
    const { page, limit } = pageInfo(req);
    const result = await leaderboardService.getGlobal(page, limit, viewerUserId(req));
    return sendSuccess(res, result, 'Global leaderboard retrieved successfully.');
  }

  /** GAM-07 */
  async getByCountry(req: Request, res: Response): Promise<Response> {
    const { page, limit } = pageInfo(req);
    const result = await leaderboardService.getByCountry(
      req.params.countryCode,
      page,
      limit,
      viewerUserId(req),
    );
    return sendSuccess(res, result, 'Country leaderboard retrieved successfully.');
  }

  /** GAM-08 */
  async getSeason(req: Request, res: Response): Promise<Response> {
    const { page, limit } = pageInfo(req);
    const result = await leaderboardService.getSeason(
      Number(req.params.seasonId),
      page,
      limit,
      viewerUserId(req),
    );
    return sendSuccess(res, result, 'Season leaderboard retrieved successfully.');
  }

  /** GAM-09 */
  async getClass(req: Request, res: Response): Promise<Response> {
    const result = await leaderboardService.getClass(Number(req.params.classId), actorFrom(req));
    return sendSuccess(res, result, 'Class leaderboard retrieved successfully.');
  }

  /** GAM-10 */
  async getOrg(req: Request, res: Response): Promise<Response> {
    const result = await leaderboardService.getOrg(Number(req.params.orgId), actorFrom(req));
    return sendSuccess(res, result, 'Organization leaderboard retrieved successfully.');
  }

  /** GAM-11 */
  async listSeasons(_req: Request, res: Response): Promise<Response> {
    const seasons = await seasonService.listSeasons();
    return sendSuccess(res, seasons, 'Seasons retrieved successfully.');
  }

  /** GAM-12 */
  async getSeasonDetail(req: Request, res: Response): Promise<Response> {
    const season = await seasonService.getSeasonDetail(Number(req.params.seasonId));
    return sendSuccess(res, season, 'Season retrieved successfully.');
  }
}

export const leaderboardController = new LeaderboardController();