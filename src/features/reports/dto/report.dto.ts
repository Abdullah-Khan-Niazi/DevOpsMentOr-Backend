import type { RoleDistributionReport, UserStatusReport } from '../types';

export interface UsersReportDto {
  totalUsers: number;
  byStatus: UserStatusReport[];
  byRole: RoleDistributionReport[];
  generatedAt: Date;
}
