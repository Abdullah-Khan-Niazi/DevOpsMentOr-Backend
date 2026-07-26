import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { PaginationQueryDto } from '../../../shared/validators';
import type { CreateRoleDto, UpdateRoleDto } from '../dto/role.dto';
import { roleService } from '../services/role.service';

export class RoleController {
  async createRole(req: Request, res: Response): Promise<Response> {
    const body = req.body as CreateRoleDto;
    const role = await roleService.createRole(body);
    return sendSuccess(res, role, 'Role created successfully.', HTTP_STATUS.CREATED);
  }

  async getRoles(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as PaginationQueryDto;
    const result = await roleService.getRoles({
      page: query.page,
      limit: query.limit,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return sendSuccess(res, result, 'Roles retrieved successfully.');
  }

  async getRoleById(req: Request, res: Response): Promise<Response> {
    const role = await roleService.getRoleById(req.params.id);
    return sendSuccess(res, role, 'Role retrieved successfully.');
  }

  async updateRole(req: Request, res: Response): Promise<Response> {
    const body = req.body as UpdateRoleDto;
    const role = await roleService.updateRole(req.params.id, body);
    return sendSuccess(res, role, 'Role updated successfully.');
  }

  async deleteRole(req: Request, res: Response): Promise<Response> {
    await roleService.deleteRole(req.params.id);
    return sendSuccess(res, null, 'Role deleted successfully.');
  }
}

export const roleController = new RoleController();
