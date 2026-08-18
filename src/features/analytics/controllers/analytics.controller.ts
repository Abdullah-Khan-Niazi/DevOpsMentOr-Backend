import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AnalyticsService } from '../services/analytics.service';
import { analyticsService } from '../services/analytics.service';

/** F8 §07 analytics HTTP handlers (OPS-41/42). */
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService = analyticsService) {}

  /** OPS-41: KPI overview. */
  async getOverview(_req: Request, res: Response): Promise<Response> {
    const overview = await this.service.getOverview();
    return sendSuccess(res, overview, 'Analytics overview retrieved successfully.');
  }

  /** OPS-42: daily activity trend. */
  async getActivityTrend(req: Request, res: Response): Promise<Response> {
    const trend = await this.service.getActivityTrend(Number(req.query.days));
    return sendSuccess(res, trend, 'Activity trend retrieved successfully.');
  }
}

export const analyticsController = new AnalyticsController();