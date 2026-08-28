import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/validators';

export const createPermissionSchema = z.object({
  permissionName: z.string().trim().min(3).max(100),
  description: z.string().trim().max(255).optional(),
  module: z.string().trim().min(2).max(50).toLowerCase().optional(),
});

export const updatePermissionSchema = z
  .object({
    permissionName: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(255).optional(),
    module: z.string().trim().min(2).max(50).toLowerCase().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export const listPermissionsQuerySchema = paginationQuerySchema.extend({
  module: z.string().trim().optional(),
});