import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AuditLogFilter } from '../dto/admin.dto';
import { adminAuditService } from '../services/admin-audit.service';

export class AdminAuditController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as {
      page: number;
      pageSize: number;
      action?: string;
      targetType?: string;
      search?: string;
      from?: string;
      to?: string;
    };

    const filter: AuditLogFilter = {
      page: query.page,
      pageSize: query.pageSize,
      action: query.action,
      targetType: query.targetType,
      search: query.search,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };

    const result = await adminAuditService.list(filter);
    return sendSuccess(res, result, 'Audit logs retrieved successfully.');
  }

  async getMetadata(_req: Request, res: Response): Promise<Response> {
    const result = await adminAuditService.getMetadata();
    return sendSuccess(res, result, 'Audit metadata retrieved successfully.');
  }
}

export const adminAuditController = new AdminAuditController();