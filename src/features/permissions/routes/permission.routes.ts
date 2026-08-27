import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizePermissions,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { numberParamSchema } from '../../../shared/validators';
import { permissionController } from '../controllers/permission.controller';
import {
  createPermissionSchema,
  listPermissionsQuerySchema,
  updatePermissionSchema,
} from '../validators/permission.validator';

const permissionRoutes = Router();

permissionRoutes.use(authenticate);

permissionRoutes.get(
  '/',
  authorizePermissions(PERMISSIONS.PERMISSIONS_READ),
  validateRequest(listPermissionsQuerySchema, 'query'),
  asyncHandler((req, res) => permissionController.getPermissions(req, res)),
);

permissionRoutes.get(
  '/:id',
  authorizePermissions(PERMISSIONS.PERMISSIONS_READ),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => permissionController.getPermissionById(req, res)),
);

permissionRoutes.post(
  '/',
  authorizePermissions(PERMISSIONS.PERMISSIONS_MANAGE),
  validateRequest(createPermissionSchema, 'body'),
  asyncHandler((req, res) => permissionController.createPermission(req, res)),
);

permissionRoutes.patch(
  '/:id',
  authorizePermissions(PERMISSIONS.PERMISSIONS_MANAGE),
  validateRequest(numberParamSchema, 'params'),
  validateRequest(updatePermissionSchema, 'body'),
  asyncHandler((req, res) => permissionController.updatePermission(req, res)),
);

permissionRoutes.delete(
  '/:id',
  authorizePermissions(PERMISSIONS.PERMISSIONS_MANAGE),
  validateRequest(numberParamSchema, 'params'),
  asyncHandler((req, res) => permissionController.deletePermission(req, res)),
);

export { permissionRoutes };
