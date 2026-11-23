import { Router } from 'express';
import { env } from '../../../app/config/env';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, optionalAuthenticate, rateLimit, requireCsrf, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminInviteController } from '../controllers/admin-invite.controller';
import { apiTokenController } from '../controllers/api-token.controller';
import { authController } from '../controllers/auth.controller';
import {
  acceptAdminInviteSchema,
  adminInviteSchema,
  adminLoginSchema,
  createApiTokenSchema,
  disable2faSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutAllSchema,
  logoutSchema,
  oAuthCompleteSchema,
  oAuthLoginSchema,
  oAuthSignupSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  setPasswordSchema,
  verify2faSchema,
  verifyEmailSchema,
} from '../validators/auth.validator';

const authRoutes = Router();

// Credential surfaces fail closed: if Redis is down, reject with 503 instead
// of silently disabling brute-force protection.
const authLimiter = rateLimit({
  scope: 'auth',
  windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  max: env.AUTH_RATE_LIMIT_MAX,
  failClosed: true,
});

const adminLimiter = rateLimit({
  scope: 'admin-login',
  windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  max: env.AUTH_RATE_LIMIT_MAX,
  failClosed: true,
});

const refreshLimiter = rateLimit({
  scope: 'refresh',
  windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  max: env.AUTH_RATE_LIMIT_MAX,
  failClosed: true,
});

// ─── Public credential surface (all rate-limited) ──────────────────────────
authRoutes.post(
  '/register',
  authLimiter,
  validateRequest(registerSchema, 'body'),
  asyncHandler((req, res) => authController.register(req, res)),
);

authRoutes.post(
  '/verify-email',
  authLimiter,
  validateRequest(verifyEmailSchema, 'body'),
  asyncHandler((req, res) => authController.verifyEmail(req, res)),
);

authRoutes.post(
  '/resend-verification',
  authLimiter,
  validateRequest(resendVerificationSchema, 'body'),
  asyncHandler((req, res) => authController.resendVerification(req, res)),
);

authRoutes.post(
  '/login',
  authLimiter,
  validateRequest(loginSchema, 'body'),
  asyncHandler((req, res) => authController.login(req, res)),
);

authRoutes.post(
  '/forgot-password',
  authLimiter,
  validateRequest(forgotPasswordSchema, 'body'),
  asyncHandler((req, res) => authController.forgotPassword(req, res)),
);

authRoutes.post(
  '/reset-password',
  authLimiter,
  validateRequest(resetPasswordSchema, 'body'),
  asyncHandler((req, res) => authController.resetPassword(req, res)),
);

authRoutes.post(
  '/set-password',
  authenticate,
  authLimiter,
  validateRequest(setPasswordSchema, 'body'),
  asyncHandler((req, res) => authController.setPassword(req, res)),
);

// ─── Session lifecycle ─────────────────────────────────────────────────────
authRoutes.get('/csrf', (req, res) => authController.getCsrfToken(req, res));

authRoutes.post(
  '/refresh',
  refreshLimiter,
  requireCsrf,
  validateRequest(refreshTokenSchema, 'body'),
  asyncHandler((req, res) => authController.refreshToken(req, res)),
);

// The access token is optional here: logout must still clear the refresh
// cookie after the 15-minute access token has expired.
authRoutes.post(
  '/logout',
  optionalAuthenticate,
  requireCsrf,
  validateRequest(logoutSchema, 'body'),
  asyncHandler((req, res) => authController.logout(req, res)),
);

authRoutes.post(
  '/logout-all',
  authenticate,
  requireCsrf,
  validateRequest(logoutAllSchema, 'body'),
  asyncHandler((req, res) => authController.logoutAll(req, res)),
);

authRoutes.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => authController.getMe(req, res)),
);

// ─── OAuth: Google and GitHub only ─────────────────────────────────────────
authRoutes.post(
  '/oauth/login',
  validateRequest(oAuthLoginSchema, 'body'),
  asyncHandler((req, res) => authController.oauthLogin(req, res)),
);

authRoutes.post(
  '/oauth/signup',
  validateRequest(oAuthSignupSchema, 'body'),
  asyncHandler((req, res) => authController.oauthSignup(req, res)),
);

authRoutes.post(
  '/oauth/complete',
  authLimiter,
  validateRequest(oAuthCompleteSchema, 'body'),
  asyncHandler((req, res) => authController.oauthComplete(req, res)),
);

// ─── Two-factor authentication ─────────────────────────────────────────────
// All three routes are rate-limited: unlimited TOTP guessing against
// enable/verify/disable is an account-takeover path with a stolen token.
authRoutes.post(
  '/2fa/enable',
  authLimiter,
  authenticate,
  asyncHandler((req, res) => authController.enable2fa(req, res)),
);

authRoutes.post(
  '/2fa/verify',
  authLimiter,
  authenticate,
  validateRequest(verify2faSchema, 'body'),
  asyncHandler((req, res) => authController.verify2fa(req, res)),
);

authRoutes.post(
  '/2fa/disable',
  authLimiter,
  authenticate,
  validateRequest(disable2faSchema, 'body'),
  asyncHandler((req, res) => authController.disable2fa(req, res)),
);

// ─── Admin surface (no separate admin app; role-gated in this API) ─────────
authRoutes.post(
  '/admin/login',
  adminLimiter,
  validateRequest(adminLoginSchema, 'body'),
  asyncHandler((req, res) => authController.adminLogin(req, res)),
);

authRoutes.post(
  '/admin/accept-invite',
  authLimiter,
  validateRequest(acceptAdminInviteSchema, 'body'),
  asyncHandler((req, res) => adminInviteController.accept(req, res)),
);

authRoutes.get(
  '/admin/invites',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_INVITE),
  asyncHandler((req, res) => adminInviteController.list(req, res)),
);

authRoutes.post(
  '/admin/invite',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_INVITE),
  validateRequest(adminInviteSchema, 'body'),
  asyncHandler((req, res) => adminInviteController.send(req, res)),
);

authRoutes.patch(
  '/admin/invite/:inviteId/revoke',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_ADMIN_INVITE),
  asyncHandler((req, res) => adminInviteController.revoke(req, res)),
);

// ─── Audit & personal tokens ───────────────────────────────────────────────
authRoutes.get(
  '/login-history',
  authenticate,
  authorizePermissions(PERMISSIONS.AUTH_LOGIN_HISTORY_READ),
  asyncHandler((req, res) => authController.getLoginHistory(req, res)),
);

authRoutes.get(
  '/api-tokens',
  authenticate,
  authorizePermissions(PERMISSIONS.AUTH_APITOKEN_READ),
  asyncHandler((req, res) => apiTokenController.list(req, res)),
);

authRoutes.post(
  '/api-tokens',
  authenticate,
  authorizePermissions(PERMISSIONS.AUTH_APITOKEN_CREATE),
  validateRequest(createApiTokenSchema, 'body'),
  asyncHandler((req, res) => apiTokenController.create(req, res)),
);

authRoutes.delete(
  '/api-tokens/:tokenId',
  authenticate,
  authorizePermissions(PERMISSIONS.AUTH_APITOKEN_DELETE),
  asyncHandler((req, res) => apiTokenController.revoke(req, res)),
);

export { authRoutes };