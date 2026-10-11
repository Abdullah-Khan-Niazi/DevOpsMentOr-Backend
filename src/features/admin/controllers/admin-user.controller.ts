import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor } from '../dto/admin.dto';
import { adminUserService } from '../services/admin-user.service';

function actorFrom(req: Request): AdminActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

export class AdminUserController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as {
      page: number;
      pageSize: number;
      search?: string;
      role?: string;
      isBanned?: string;
      isActive?: string;
      isDeleted?: string;
      organizationId?: number;
      country?: string;
    };
    const result = await adminUserService.listUsers({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      role: query.role,
      isBanned: toOptionalBoolean(query.isBanned),
      isActive: toOptionalBoolean(query.isActive),
      isDeleted: toOptionalBoolean(query.isDeleted),
      organizationId: query.organizationId ? Number(query.organizationId) : undefined,
      country: query.country,
    });
    return sendSuccess(res, result, 'Users retrieved successfully.');
  }

  async invite(req: Request, res: Response): Promise<Response> {
    const result = await adminUserService.inviteUsers(actorFrom(req), req.body);
    return sendSuccess(res, result, 'Invitations dispatched successfully.');
  }

  async detail(req: Request, res: Response): Promise<Response> {
    const detail = await adminUserService.getUserDetail(Number(req.params.userId));
    return sendSuccess(res, detail, 'User detail retrieved successfully.');
  }

  async ban(req: Request, res: Response): Promise<Response> {
    const result = await adminUserService.banUser(
      actorFrom(req),
      Number(req.params.userId),
      req.body.banReason,
    );
    return sendSuccess(res, result, 'User banned successfully.');
  }

  async unban(req: Request, res: Response): Promise<Response> {
    const result = await adminUserService.unbanUser(actorFrom(req), Number(req.params.userId));
    return sendSuccess(res, result, 'User unbanned successfully.');
  }

  async delete(req: Request, res: Response): Promise<Response> {
    const result = await adminUserService.deleteUser(actorFrom(req), Number(req.params.userId));
    return sendSuccess(res, result, 'User deleted successfully.');
  }

  async restore(req: Request, res: Response): Promise<Response> {
    const result = await adminUserService.restoreUser(actorFrom(req), Number(req.params.userId));
    return sendSuccess(res, result, 'User restored successfully.');
  }

  async listPlatformAdmins(_req: Request, res: Response): Promise<Response> {
    const admins = await adminUserService.listPlatformAdmins();
    return sendSuccess(res, admins, 'Platform admins retrieved successfully.');
  }
}

export const adminUserController = new AdminUserController();