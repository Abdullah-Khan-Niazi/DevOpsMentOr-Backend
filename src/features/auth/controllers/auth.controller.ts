import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { UnauthorizedError } from '../../../shared/errors';
import { sendSuccess } from '../../../shared/utils';
import { authService } from '../services/auth.service';
import type { LoginDto, RefreshTokenDto, RegisterDto } from '../dto/auth.dto';

export class AuthController {
  async register(req: Request, res: Response): Promise<Response> {
    const body = req.body as RegisterDto;
    const result = await authService.register(body);
    return sendSuccess(res, result, 'User registered successfully.', HTTP_STATUS.CREATED);
  }

  async login(req: Request, res: Response): Promise<Response> {
    const body = req.body as LoginDto;
    const result = await authService.login(body);
    return sendSuccess(res, result, 'Login successful.');
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const body = req.body as RefreshTokenDto;
    const result = await authService.refresh(body.refreshToken);
    return sendSuccess(res, result, 'Token refreshed successfully.');
  }

  async logout(req: Request, res: Response): Promise<Response> {
    const body = req.body as RefreshTokenDto;
    await authService.logout(body.refreshToken);
    return sendSuccess(res, null, 'Logout successful.');
  }

  async logoutAll(req: Request, res: Response): Promise<Response> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }
    await authService.logoutAll(req.user.sub);
    return sendSuccess(res, null, 'Logged out from all sessions.');
  }

  async me(req: Request, res: Response): Promise<Response> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }
    return sendSuccess(
      res,
      {
        id: req.user.sub,
        email: req.user.email,
        roles: req.user.roles,
        permissions: req.user.permissions,
      },
      'Current user retrieved successfully.',
    );
  }
}

export const authController = new AuthController();
