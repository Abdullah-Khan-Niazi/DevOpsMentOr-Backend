import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { authService } from '../services/auth.service';
import type {
  AdminLoginDto,
  Enable2faDto,
  ForgotPasswordDto,
  LoginDto,
  OAuthCompleteDto,
  OAuthLoginDto,
  OAuthSignupDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationDto,
  Verify2faDto,
  VerifyEmailDto,
} from '../dto/auth.dto';

export class AuthController {
  async register(req: Request, res: Response): Promise<Response> {
    const result = await authService.register(req.body as RegisterDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, result, 'Registration successful.', HTTP_STATUS.CREATED);
  }

  async verifyEmail(req: Request, res: Response): Promise<Response> {
    const result = await authService.verifyEmail(req.body as VerifyEmailDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, result, 'Email verified.', HTTP_STATUS.OK);
  }

  async resendVerification(req: Request, res: Response): Promise<Response> {
    const result = await authService.resendVerification(req.body as ResendVerificationDto);
    return sendSuccess(res, result, 'Verification code sent.', HTTP_STATUS.OK);
  }

  async login(req: Request, res: Response): Promise<Response> {
    const result = await authService.login(req.body as LoginDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'Login successful.', HTTP_STATUS.OK);
  }

  async refreshToken(req: Request, res: Response): Promise<Response> {
    const tokens = await authService.refreshToken(req.body as RefreshTokenDto);
    return sendSuccess(res, tokens, 'Token refreshed successfully.', HTTP_STATUS.OK);
  }

  async logout(req: Request, res: Response): Promise<Response> {
    const body = req.body as RefreshTokenDto;
    await authService.logout(body, req.user?.jti);
    return sendSuccess(res, null, 'Logged out successfully.', HTTP_STATUS.OK);
  }

  async getMe(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.getMe(userId);
    return sendSuccess(res, result, 'User retrieved successfully.', HTTP_STATUS.OK);
  }

  async oauthLogin(req: Request, res: Response): Promise<Response> {
    const result = await authService.oauthLogin(req.body as OAuthLoginDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if ('exists' in result && !result.exists) {
      return sendSuccess(res, result, 'OAuth account setup required.', HTTP_STATUS.OK);
    }

    return sendSuccess(res, result, 'OAuth login successful.', HTTP_STATUS.OK);
  }

  async oauthSignup(req: Request, res: Response): Promise<Response> {
    const result = await authService.oauthSignup(req.body as OAuthSignupDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if ('exists' in result && !result.exists) {
      return sendSuccess(res, result, 'OAuth account setup required.', HTTP_STATUS.OK);
    }

    return sendSuccess(res, result, 'OAuth signup successful.', HTTP_STATUS.CREATED);
  }

  async oauthComplete(req: Request, res: Response): Promise<Response> {
    const result = await authService.completeOAuthRegistration(req.body as OAuthCompleteDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'OAuth account created.', HTTP_STATUS.CREATED);
  }

  async forgotPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.forgotPassword(req.body as ForgotPasswordDto);
    return sendSuccess(res, result, 'Reset code sent.', HTTP_STATUS.OK);
  }

  async resetPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.resetPassword(req.body as ResetPasswordDto);
    return sendSuccess(res, result, 'Password reset.', HTTP_STATUS.OK);
  }

  async enable2fa(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.enable2fa(userId, req.body as Enable2faDto);
    return sendSuccess(res, result, '2FA setup initiated.', HTTP_STATUS.OK);
  }

  async verify2fa(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.verify2fa(userId, req.body as Verify2faDto);
    return sendSuccess(res, result, '2FA enabled.', HTTP_STATUS.OK);
  }

  async disable2fa(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.disable2fa(userId, req.body as Verify2faDto);
    return sendSuccess(res, result, '2FA disabled.', HTTP_STATUS.OK);
  }

  async adminLogin(req: Request, res: Response): Promise<Response> {
    const result = await authService.adminLogin(req.body as AdminLoginDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'Admin login successful.', HTTP_STATUS.OK);
  }

  async getLoginHistory(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.getLoginHistory(userId);
    return sendSuccess(res, result, 'Login history retrieved.', HTTP_STATUS.OK);
  }
}

export const authController = new AuthController();