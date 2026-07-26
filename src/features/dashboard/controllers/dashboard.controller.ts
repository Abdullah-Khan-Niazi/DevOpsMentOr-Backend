import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { dashboardService } from '../services/dashboard.service';

export class DashboardController {
  async getSummary(_req: Request, res: Response): Promise<Response> {
    const summary = await dashboardService.getSummary();
    return sendSuccess(res, summary, 'Dashboard summary retrieved successfully.');
  }
}

export const dashboardController = new DashboardController();
