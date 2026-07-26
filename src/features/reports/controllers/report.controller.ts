import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { reportService } from '../services/report.service';

export class ReportController {
  async getUsersReport(_req: Request, res: Response): Promise<Response> {
    const report = await reportService.getUsersReport();
    return sendSuccess(res, report, 'Users report generated successfully.');
  }
}

export const reportController = new ReportController();
