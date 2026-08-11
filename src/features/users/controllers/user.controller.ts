import type { Request, Response } from 'express';
import { HTTP_STATUS, PERMISSIONS, type UserStatus } from '../../../shared/constants';
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

  // ─── F2 — Users / Profiles / Platform Administration ─────────────────────

  async getMe(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const me = await userService.getMe(userId);
    return sendSuccess(res, me, 'Session identity retrieved successfully.');
  }

  async updateProfile(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const profile = await userService.updateMyProfile(userId, req.body);
    return sendSuccess(res, profile, 'Profile updated successfully.');
  }

  async uploadAvatar(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const ipAddress = req.ip ?? null;
    const result = await userService.uploadAvatar(userId, req.file!, ipAddress);
    return sendSuccess(res, result, 'Avatar uploaded successfully.');
  }

  async uploadCover(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const ipAddress = req.ip ?? null;
    const result = await userService.uploadCover(userId, req.file!, ipAddress);
    return sendSuccess(res, result, 'Cover photo uploaded successfully.');
  }

  async getMySkills(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const skills = await userService.getMySkills(userId);
    return sendSuccess(res, skills, 'Skills retrieved successfully.');
  }

  async addSkill(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const skill = await userService.addSkill(userId, req.body);
    return sendSuccess(res, skill, 'Skill added successfully.', HTTP_STATUS.CREATED);
  }

  async removeSkill(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const skillId = Number(req.params.skillId);
    await userService.removeSkill(userId, skillId);
    return sendSuccess(res, null, 'Skill removed successfully.');
  }

  async getSettings(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const settings = await userService.getSettings(userId);
    return sendSuccess(res, settings, 'Settings retrieved successfully.');
  }

  async updateSettings(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const settings = await userService.updateSettings(userId, req.body.settings);
    return sendSuccess(res, settings, 'Settings updated successfully.');
  }

  async getPublicProfile(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.params.userId);
    const viewer = req.user
      ? {
          userId: Number(req.user.sub),
          hasUserRead: req.user.permissions.includes(PERMISSIONS.PLATFORM_USERS_READ),
        }
      : null;
    const profile = await userService.getPublicProfile(userId, viewer);
    return sendSuccess(res, profile, 'Profile retrieved successfully.');
  }

  async follow(req: Request, res: Response): Promise<Response> {
    const followerId = Number(req.user?.sub);
    const followingId = Number(req.params.userId);
    const result = await userService.followUser(followerId, followingId);
    return sendSuccess(res, result, 'Now following this user.', HTTP_STATUS.CREATED);
  }

  async unfollow(req: Request, res: Response): Promise<Response> {
    const followerId = Number(req.user?.sub);
    const followingId = Number(req.params.userId);
    const result = await userService.unfollowUser(followerId, followingId);
    return sendSuccess(res, result, 'Unfollowed this user.');
  }
}

export const userController = new UserController();