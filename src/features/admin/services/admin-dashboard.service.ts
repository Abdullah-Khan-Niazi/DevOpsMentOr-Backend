import { cacheKeys, redisClient } from '../../../app/cache/redis';
import type { AdminDashboardDto } from '../dto/admin.dto';
import type { IAdminDashboardRepository } from '../repositories/admin-dashboard.repository';
import { adminDashboardRepository } from '../repositories/admin-dashboard.repository';

const KPI_CACHE_TTL_SECONDS = 5 * 60;

/**
 * ADM-06: platform KPI dashboard. Aggregates are live database queries
 * (F2 §06) cached in Redis for 5 minutes. `labsCompleted` remains a forward
 * hook from F6 until lab execution ships.
 */
export class AdminDashboardService {
  constructor(private readonly dashboard: IAdminDashboardRepository = adminDashboardRepository) {}

  async getKPIs(): Promise<AdminDashboardDto> {
    const cacheKey = cacheKeys.adminDashboard();
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AdminDashboardDto;
    }

    const [kpis, recentAuditLogs] = await Promise.all([
      this.dashboard.getKpis(),
      this.dashboard.getRecentAuditLogs(10),
    ]);

    const payload: AdminDashboardDto = { kpis, recentAuditLogs };
    await redisClient.set(cacheKey, JSON.stringify(payload), 'EX', KPI_CACHE_TTL_SECONDS);

    return payload;
  }
}

export const adminDashboardService = new AdminDashboardService();