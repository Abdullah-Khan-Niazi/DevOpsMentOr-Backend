import type { DashboardSummaryDto } from '../dto/dashboard.dto';
import type { IDashboardRepository } from '../repositories/dashboard.repository';
import { dashboardRepository } from '../repositories/dashboard.repository';

export class DashboardService {
  constructor(private readonly dashboard: IDashboardRepository = dashboardRepository) {}

  async getSummary(): Promise<DashboardSummaryDto> {
    return this.dashboard.getSummary();
  }
}

export const dashboardService = new DashboardService();
