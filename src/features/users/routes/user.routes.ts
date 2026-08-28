import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  optionalAuthenticate,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler, sendSuccess } from '../../../shared/utils';
import { numberParamSchema } from '../../../shared/validators';
import { userController } from '../controllers/user.controller';
import { userService } from '../services/user.service';
import { singleImageUpload } from '../services/upload.service';
import {
  addMySkillSchema,
  createUserSchema,
  listUsersQuerySchema,
  skillIdParamSchema,
  updateMyProfileSchema,
  updateMySettingsSchema,
  updateUserSchema,
  userIdParamSchema,
} from '../validators/user.validator';

const userRoutes = Router();

// ─── F2 — own-identity surface (USR-01..09) ────────────────────────────────

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get own session identity (USR-01)
 */
userRoutes.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => userController.getMe(req, res)),
);

/**
 * @openapi
 * /users/me/profile:
 *   patch:
 *     tags: [Users]
 *     summary: Update own profile (USR-02)
 */
userRoutes.patch(
  '/me/profile',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_PROFILE_UPDATE),
  validateRequest(updateMyProfileSchema),
  asyncHandler((req, res) => userController.updateProfile(req, res)),
);

/**
 * @openapi
 * /users/me/avatar:
 *   post:
 *     tags: [Users]
 *     summary: Upload own avatar (USR-03)
 */
userRoutes.post(
  '/me/avatar',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_PROFILE_UPDATE),
  singleImageUpload('avatar'),
  asyncHandler((req, res) => userController.uploadAvatar(req, res)),
);

/**
 * @openapi
 * /users/me/cover:
 *   post:
 *     tags: [Users]
 *     summary: Upload own cover photo (USR-04)
 */
userRoutes.post(
  '/me/cover',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_PROFILE_UPDATE),
  singleImageUpload('cover'),
  asyncHandler((req, res) => userController.uploadCover(req, res)),
);

/**
 * @openapi
 * /users/me/skills:
 *   get:
 *     tags: [Users]
 *     summary: List own skills (USR-05)
 */
userRoutes.get(
  '/me/skills',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_SKILLS_MANAGE),
  asyncHandler((req, res) => userController.getMySkills(req, res)),
);

/**
 * @openapi
 * /users/me/skills:
 *   post:
 *     tags: [Users]
 *     summary: Add a skill from the catalog (USR-06)
 */
userRoutes.post(
  '/me/skills',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_SKILLS_MANAGE),
  validateRequest(addMySkillSchema),
  asyncHandler((req, res) => userController.addSkill(req, res)),
);

/**
 * @openapi
 * /users/me/skills/{skillId}:
 *   delete:
 *     tags: [Users]
 *     summary: Remove own skill (USR-07)
 */
userRoutes.delete(
  '/me/skills/:skillId',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_SKILLS_MANAGE),
  validateRequest(skillIdParamSchema, 'params'),
  asyncHandler((req, res) => userController.removeSkill(req, res)),
);

/**
 * @openapi
 * /users/me/settings:
 *   get:
 *     tags: [Users]
 *     summary: Get own user settings (USR-08)
 */
userRoutes.get(
  '/me/settings',
  authenticate,
  asyncHandler((req, res) => userController.getSettings(req, res)),
);

/**
 * @openapi
 * /users/me/settings:
 *   patch:
 *     tags: [Users]
 *     summary: Update own user settings (USR-09)
 */
userRoutes.patch(
  '/me/settings',
  authenticate,
  validateRequest(updateMySettingsSchema),
  asyncHandler((req, res) => userController.updateSettings(req, res)),
);

// ─── F2 — public profile + follow surface (USR-10..12, forward hooks) ──────

/**
 * @openapi
 * /users/{userId}:
 *   get:
 *     tags: [Users]
 *     summary: Get public profile (USR-10)
 */
userRoutes.get(
  '/:userId',
  optionalAuthenticate,
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => userController.getPublicProfile(req, res)),
);

/**
 * @openapi
 * /users/{userId}/follow:
 *   post:
 *     tags: [Users]
 *     summary: Follow a user (USR-11)
 */
userRoutes.post(
  '/:userId/follow',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_FOLLOW_MANAGE),
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => userController.follow(req, res)),
);

/**
 * @openapi
 * /users/{userId}/follow:
 *   delete:
 *     tags: [Users]
 *     summary: Unfollow a user (USR-12)
 */
userRoutes.delete(
  '/:userId/follow',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_FOLLOW_MANAGE),
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => userController.unfollow(req, res)),
);

/**
 * @openapi
 * /users/{userId}/snapshot:
 *   get:
 *     tags: [Users]
 *     summary: Lightweight user card (F2 forward hook for F3/F6)
 */
userRoutes.get(
  '/:userId/snapshot',
  authenticate,
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const snapshot = await userService.getSnapshot(Number(req.params.userId));
    return sendSuccess(res, snapshot, 'User snapshot retrieved successfully.');
  }),
);

// ─── F1 — admin user CRUD surface ─────────────────────────────────────────

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users
 */
userRoutes.get(
  '/',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_READ),
  validateRequest(listUsersQuerySchema, 'query'),
  asyncHandler((req, res) => userController.getUsers(req, res)),
);

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create user
 */
userRoutes.post(
  '/',
  authenticate,
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
 */
userRoutes.patch(
  '/:id',
  authenticate,
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
 */
userRoutes.delete(
  '/:id',
  authenticate,
  authorizePermissions(PERMISSIONS.USERS_DELETE),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => userController.deleteUser(req, res)),
);

export { userRoutes };