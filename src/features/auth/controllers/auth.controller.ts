import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { authService } from '../services/auth.service';
import type {
  LoginDto,
  MeResponseDto,
  OAuthLoginDto,
  OAuthSignupDto,
  RefreshTokenDto,
  RegisterDto,
} from '../dto/auth.dto';

export class AuthController {
  async register(req: Request, res: Response): Promise<Response> {
    const body = req.body as RegisterDto;

    const result = await authService.register(body);

    return sendSuccess(
      res,
      result,
      'User registered successfully.',
      HTTP_STATUS.CREATED,
    );
  }

  async login(req: Request, res: Response): Promise<Response> {
    const body = req.body as LoginDto;

    const result = await authService.login(body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'Login successful.', HTTP_STATUS.OK);
  }

  async refreshToken(req: Request, res: Response): Promise<Response> {
    const body = req.body as RefreshTokenDto;

    const tokens = await authService.refreshToken(body.refreshToken);

    return sendSuccess(res, tokens, 'Token refreshed successfully.', HTTP_STATUS.OK);
  }

  async logout(req: Request, res: Response): Promise<Response> {
    const body = req.body as RefreshTokenDto;

    await authService.logout(body.refreshToken);

    return sendSuccess(res, null, 'Logged out successfully.', HTTP_STATUS.OK);
  }

  async getMe(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);

    const result: MeResponseDto = await authService.getMe(userId);

    return sendSuccess(res, result, 'User retrieved successfully.', HTTP_STATUS.OK);
  }

  async oauthLogin(req: Request, res: Response): Promise<Response> {
    const body = req.body as OAuthLoginDto;

    const result = await authService.oauthLogin(body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'OAuth login successful.', HTTP_STATUS.OK);
  }

  async oauthSignup(req: Request, res: Response): Promise<Response> {
    const body = req.body as OAuthSignupDto;

    const result = await authService.oauthSignup(body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'OAuth signup successful.', HTTP_STATUS.CREATED);
  }
}

export const authController = new AuthController();
