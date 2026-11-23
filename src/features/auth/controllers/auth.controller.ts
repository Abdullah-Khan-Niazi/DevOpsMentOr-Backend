import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors';
import { sendSuccess } from '../../../shared/utils';
import {
  AUTH_COOKIES,
  clearAuthCookies,
  ensureCsrfCookie,
  readCookie,
  setAuthCookies,
} from '../../../shared/utils/auth-cookies';
import { authService } from '../services/auth.service';
import type {
  AdminLoginDto,
  AuthResponseDto,
  AuthSessionBodyDto,
  AuthTokensDto,
  Disable2faDto,
  Enable2faDto,
  ForgotPasswordDto,
  IssuedAuthTokensDto,
  LoginDto,
  OAuthCompleteDto,
  OAuthLoginDto,
  OAuthSignupDto,
  RegisterDto,
  ResetPasswordDto,
  ResendVerificationDto,
  SetPasswordDto,
  Verify2faDto,
  VerifyEmailDto,
} from '../dto/auth.dto';

/** Strips the refresh token from an issued pair; the refresh token only ever leaves the server as a cookie. */
function toPublicTokens(tokens: IssuedAuthTokensDto): AuthTokensDto {
  return { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds };
}

/** Sets the refresh and CSRF cookies and builds the body of a token-issuing response. */
function issueSession(res: Response, result: AuthResponseDto): AuthSessionBodyDto {
  setAuthCookies(res, {
    refreshToken: result.tokens.refreshToken,
    refreshExpiresAt: result.tokens.refreshExpiresAt,
  });
  return { user: result.user, tokens: toPublicTokens(result.tokens) };
}

/** Refresh token from the httpOnly cookie (the request body never carries it). */
function refreshTokenFrom(req: Request): string | null {
  return readCookie(req, AUTH_COOKIES.refresh) ?? null;
}

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
    return sendSuccess(res, issueSession(res, result), 'Email verified.', HTTP_STATUS.OK);
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

    return sendSuccess(res, issueSession(res, result), 'Login successful.', HTTP_STATUS.OK);
  }

  getCsrfToken(req: Request, res: Response): Response {
    const csrfToken = ensureCsrfCookie(req, res);
    return sendSuccess(res, { csrfToken }, 'CSRF token ready.', HTTP_STATUS.OK);
  }

  async refreshToken(req: Request, res: Response): Promise<Response> {
    try {
      const tokens = await authService.refreshToken(refreshTokenFrom(req));
      setAuthCookies(res, { refreshToken: tokens.refreshToken, refreshExpiresAt: tokens.refreshExpiresAt });
      return sendSuccess(res, toPublicTokens(tokens), 'Token refreshed successfully.', HTTP_STATUS.OK);
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
        clearAuthCookies(res);
      }
      throw err;
    }
  }

  async logout(req: Request, res: Response): Promise<Response> {
    await authService.logout(refreshTokenFrom(req), req.user?.jti);
    clearAuthCookies(res);
    return sendSuccess(res, null, 'Logged out successfully.', HTTP_STATUS.OK);
  }

  async logoutAll(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    await authService.logoutAll(userId, req.user?.jti);
    clearAuthCookies(res);
    return sendSuccess(res, null, 'Signed out of all sessions.', HTTP_STATUS.OK);
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

    if (!('tokens' in result)) {
      return sendSuccess(res, result, 'OAuth account setup required.', HTTP_STATUS.OK);
    }

    return sendSuccess(res, issueSession(res, result), 'OAuth login successful.', HTTP_STATUS.OK);
  }

  async oauthSignup(req: Request, res: Response): Promise<Response> {
    const result = await authService.oauthSignup(req.body as OAuthSignupDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (!('tokens' in result)) {
      return sendSuccess(res, result, 'OAuth account setup required.', HTTP_STATUS.OK);
    }

    return sendSuccess(res, issueSession(res, result), 'OAuth signup successful.', HTTP_STATUS.CREATED);
  }

  async oauthComplete(req: Request, res: Response): Promise<Response> {
    const result = await authService.completeOAuthRegistration(req.body as OAuthCompleteDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, issueSession(res, result), 'OAuth account created.', HTTP_STATUS.CREATED);
  }

  async forgotPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.forgotPassword(req.body as ForgotPasswordDto);
    return sendSuccess(res, result, 'Reset code sent.', HTTP_STATUS.OK);
  }

  async resetPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.resetPassword(req.body as ResetPasswordDto);
    return sendSuccess(res, result, 'Password reset.', HTTP_STATUS.OK);
  }

  async setPassword(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.setPassword(userId, req.body as SetPasswordDto);
    return sendSuccess(res, result, 'Password updated.', HTTP_STATUS.OK);
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
    const result = await authService.disable2fa(userId, req.body as Disable2faDto);
    return sendSuccess(res, result, '2FA disabled.', HTTP_STATUS.OK);
  }

  async adminLogin(req: Request, res: Response): Promise<Response> {
    const result = await authService.adminLogin(req.body as AdminLoginDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, issueSession(res, result), 'Admin login successful.', HTTP_STATUS.OK);
  }

  async getLoginHistory(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const result = await authService.getLoginHistory(userId);
    return sendSuccess(res, result, 'Login history retrieved.', HTTP_STATUS.OK);
  }
}

export const authController = new AuthController();