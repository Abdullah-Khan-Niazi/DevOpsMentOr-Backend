import type { Request, Response } from 'express';
import { HTTP_STATUS, type UserStatus } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { userService } from '../services/user.service';
import type { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import type { PaginationQueryDto } from '../../../shared/validators';

export class UserController {
  async createUser(req: Request, res: Response): Promise<Response> {
    const body = req.body as CreateUserDto;
    const user = await userService.createUser(body);
    return sendSuccess(res, user, 'User created successfully.', HTTP_STATUS.CREATED);
  }

  async getUsers(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as PaginationQueryDto & { status?: UserStatus };
    const result = await userService.getUsers({
      page: query.page,
      limit: query.limit,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      status: query.status,
    });
    return sendSuccess(res, result, 'Users retrieved successfully.');
  }

  async getUserById(req: Request, res: Response): Promise<Response> {
    const user = await userService.getUserById(Number(req.params.id));
    return sendSuccess(res, user, 'User retrieved successfully.');
  }

  async updateUser(req: Request, res: Response): Promise<Response> {
    const body = req.body as UpdateUserDto;
    const user = await userService.updateUser(Number(req.params.id), body);
    return sendSuccess(res, user, 'User updated successfully.');
  }

  async deleteUser(req: Request, res: Response): Promise<Response> {
    await userService.deleteUser(Number(req.params.id));
    return sendSuccess(res, null, 'User deleted successfully.');
  }
}

export const userController = new UserController();
