import { Router } from 'express';
import { authenticate, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { authController } from '../controllers/auth.controller';
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from '../validators/auth.validator';

const authRoutes = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 */
authRoutes.post(
  '/register',
  validateRequest(registerSchema, 'body'),
  asyncHandler((req, res) => authController.register(req, res)),
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 */
authRoutes.post(
  '/login',
  validateRequest(loginSchema, 'body'),
  asyncHandler((req, res) => authController.login(req, res)),
);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 */
authRoutes.post(
  '/refresh',
  validateRequest(refreshTokenSchema, 'body'),
  asyncHandler((req, res) => authController.refresh(req, res)),
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout current session
 */
authRoutes.post(
  '/logout',
  validateRequest(refreshTokenSchema, 'body'),
  asyncHandler((req, res) => authController.logout(req, res)),
);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Logout all sessions
 *     security:
 *       - bearerAuth: []
 */
authRoutes.post(
  '/logout-all',
  authenticate,
  asyncHandler((req, res) => authController.logoutAll(req, res)),
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 *     security:
 *       - bearerAuth: []
 */
authRoutes.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => authController.me(req, res)),
);

export { authRoutes };
