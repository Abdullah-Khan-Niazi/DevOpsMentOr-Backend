import { Router } from 'express';
import { validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { authController } from '../controllers/auth.controller';
import { registerSchema } from '../validators/auth.validator';

const authRoutes = Router();

authRoutes.post(
  '/register',
  validateRequest(registerSchema, 'body'),
  asyncHandler((req, res) => authController.register(req, res)),
);

export { authRoutes };