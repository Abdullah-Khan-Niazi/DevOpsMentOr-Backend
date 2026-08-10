import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { numberParamSchema } from '../../../shared/validators';
import { userController } from '../controllers/user.controller';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from '../validators/user.validator';

const userRoutes = Router();

userRoutes.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 *     security:
 *       - bearerAuth: []
 */
userRoutes.get(
  '/',
  authorizePermissions(PERMISSIONS.USERS_READ),
  validateRequest(listUsersQuerySchema, 'query'),
  asyncHandler((req, res) => userController.getUsers(req, res)),
);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get user by id
 *     security:
 *       - bearerAuth: []
 */
userRoutes.get(
  '/:id',
  authorizePermissions(PERMISSIONS.USERS_READ),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => userController.getUserById(req, res)),
);

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create user
 *     security:
 *       - bearerAuth: []
 */
userRoutes.post(
  '/',
  authorizePermissions(PERMISSIONS.USERS_CREATE),
  validateRequest(createUserSchema, 'body'),
  asyncHandler((req, res) => userController.createUser(req, res)),
);

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     tags: [Users]
 *     summary: Update user
 *     security:
 *       - bearerAuth: []
 */
userRoutes.patch(
  '/:id',
  authorizePermissions(PERMISSIONS.USERS_UPDATE),
  validateRequest(numberParamSchema, 'params'),
  validateRequest(updateUserSchema, 'body'),
  asyncHandler((req, res) => userController.updateUser(req, res)),
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete user
 *     security:
 *       - bearerAuth: []
 */
userRoutes.delete(
  '/:id',
  authorizePermissions(PERMISSIONS.USERS_DELETE),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => userController.deleteUser(req, res)),
);

export { userRoutes };
