import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { adminDashboardService } from '../services/admin-dashboard.service';

export class AdminDashboardController {
  async getKPIs(_req: Request, res: Response): Promise<Response> {
    const dashboard = await adminDashboardService.getKPIs();
    return sendSuccess(res, dashboard, 'Dashboard KPIs retrieved successfully.');
  }
}

export const adminDashboardController = new AdminDashboardController();