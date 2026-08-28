import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { PaginationQueryDto } from '../../../shared/validators';
import type { CreatePermissionDto, UpdatePermissionDto } from '../dto/permission.dto';
import { permissionService } from '../services/permission.service';

export class PermissionController {
  async createPermission(req: Request, res: Response): Promise<Response> {
    const body = req.body as CreatePermissionDto;
    const permission = await permissionService.createPermission(body);
    return sendSuccess(res, permission, 'Permission created successfully.', HTTP_STATUS.CREATED);
  }

  async getPermissions(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as PaginationQueryDto & { module?: string };
    const result = await permissionService.getPermissions({
      page: query.page,
      limit: query.limit,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      module: query.module,
    });
    return sendSuccess(res, result, 'Permissions retrieved successfully.');
  }

  async getPermissionById(req: Request, res: Response): Promise<Response> {
    const permission = await permissionService.getPermissionById(Number(req.params.id));
    return sendSuccess(res, permission, 'Permission retrieved successfully.');
  }

  async updatePermission(req: Request, res: Response): Promise<Response> {
    const body = req.body as UpdatePermissionDto;
    const permission = await permissionService.updatePermission(Number(req.params.id), body);
    return sendSuccess(res, permission, 'Permission updated successfully.');
  }

  async deletePermission(req: Request, res: Response): Promise<Response> {
    await permissionService.deletePermission(Number(req.params.id));
    return sendSuccess(res, null, 'Permission deleted successfully.');
  }
}

export const permissionController = new PermissionController();
