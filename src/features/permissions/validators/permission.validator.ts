import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/validators';

export const createPermissionSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(255).optional(),
  resource: z.string().trim().min(2).max(50).toLowerCase(),
  action: z.string().trim().min(2).max(50).toLowerCase(),
});

export const updatePermissionSchema = z
  .object({
    name: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(255).optional(),
    resource: z.string().trim().min(2).max(50).toLowerCase().optional(),
    action: z.string().trim().min(2).max(50).toLowerCase().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export const listPermissionsQuerySchema = paginationQuerySchema.extend({
  resource: z.string().trim().optional(),
});
