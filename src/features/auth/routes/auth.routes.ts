import { Router } from 'express';
import { validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../../../shared/middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  oAuthLoginSchema,
  oAuthSignupSchema,
} from '../validators/auth.validator';

const authRoutes = Router();

authRoutes.post(
  '/register',
  validateRequest(registerSchema, 'body'),
  asyncHandler((req, res) => authController.register(req, res)),
);

authRoutes.post(
  '/login',
  validateRequest(loginSchema, 'body'),
  asyncHandler((req, res) => authController.login(req, res)),
);

authRoutes.post(
  '/refresh',
  validateRequest(refreshTokenSchema, 'body'),
  asyncHandler((req, res) => authController.refreshToken(req, res)),
);

authRoutes.post(
  '/logout',
  validateRequest(refreshTokenSchema, 'body'),
  asyncHandler((req, res) => authController.logout(req, res)),
);

authRoutes.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => authController.getMe(req, res)),
);

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

export { authRoutes };
