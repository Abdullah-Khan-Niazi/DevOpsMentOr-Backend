import { ValidationError } from '../../../shared/errors';
import type { AuditLogFilter, AuditLogListItem, PaginatedAdminData } from '../dto/admin.dto';
import type { IAdminAuditRepository } from '../repositories/admin-audit.repository';
import { adminAuditRepository } from '../repositories/admin-audit.repository';

const MAX_AUDIT_RANGE_DAYS = 90;

export class AdminAuditService {
  constructor(private readonly logs: IAdminAuditRepository = adminAuditRepository) {}

  async list(filter: AuditLogFilter): Promise<PaginatedAdminData<AuditLogListItem>> {
    if (filter.from && filter.to) {
      const rangeDays = (filter.to.getTime() - filter.from.getTime()) / (24 * 60 * 60 * 1000);
      if (rangeDays > MAX_AUDIT_RANGE_DAYS) {
        throw new ValidationError('Date range exceeds the maximum of 90 days.');
      }
    }

    return this.logs.list(filter);
  }

  async getMetadata() {
    return this.logs.getMetadata();
  }
}

export const adminAuditService = new AdminAuditService();