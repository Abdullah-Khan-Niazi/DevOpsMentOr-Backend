import type { UsersReportDto } from '../dto/report.dto';
import type { IReportRepository } from '../repositories/report.repository';
import { reportRepository } from '../repositories/report.repository';

export class ReportService {
  constructor(private readonly reports: IReportRepository = reportRepository) {}

  async getUsersReport(): Promise<UsersReportDto> {
    const [totalUsers, byStatus, byRole] = await Promise.all([
      this.reports.countUsers(),
      this.reports.countUsersByStatus(),
      this.reports.countUsersByRole(),
    ]);

    return {
      totalUsers,
      byStatus,
      byRole,
      generatedAt: new Date(),
    };
  }
}

export const reportService = new ReportService();
