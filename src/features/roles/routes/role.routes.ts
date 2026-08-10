import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { numberParamSchema } from '../../../shared/validators';
import { roleController } from '../controllers/role.controller';
import {
  createRoleSchema,
  listRolesQuerySchema,
  updateRoleSchema,
} from '../validators/role.validator';

const roleRoutes = Router();

roleRoutes.use(authenticate);

roleRoutes.get(
  '/',
  authorizePermissions(PERMISSIONS.ROLES_READ),
  validateRequest(listRolesQuerySchema, 'query'),
  asyncHandler((req, res) => roleController.getRoles(req, res)),
);

roleRoutes.get(
  '/:id',
  authorizePermissions(PERMISSIONS.ROLES_READ),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => roleController.getRoleById(req, res)),
);

roleRoutes.post(
  '/',
  authorizePermissions(PERMISSIONS.ROLES_CREATE),
  validateRequest(createRoleSchema, 'body'),
  asyncHandler((req, res) => roleController.createRole(req, res)),
);

roleRoutes.patch(
  '/:id',
  authorizePermissions(PERMISSIONS.ROLES_UPDATE),
  validateRequest(numberParamSchema, 'params'),
  validateRequest(updateRoleSchema, 'body'),
  asyncHandler((req, res) => roleController.updateRole(req, res)),
);

roleRoutes.delete(
  '/:id',
  authorizePermissions(PERMISSIONS.ROLES_DELETE),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => roleController.deleteRole(req, res)),
);

export { roleRoutes };
