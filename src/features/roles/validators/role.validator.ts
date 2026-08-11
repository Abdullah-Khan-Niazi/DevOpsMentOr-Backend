import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/validators';

export const createRoleSchema = z.object({
  roleName: z
    .string()
    .trim()
    .min(2, 'Role name is required.')
    .max(50)
    .transform((v) => v.toUpperCase().replace(/\s+/g, '_')),
  description: z.string().trim().max(255).optional(),
  permissionIds: z.array(z.number().int().positive()).optional(),
});

export const updateRoleSchema = z
  .object({
    roleName: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .transform((v) => v.toUpperCase().replace(/\s+/g, '_'))
      .optional(),
    description: z.string().trim().max(255).optional(),
    permissionIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export const listRolesQuerySchema = paginationQuerySchema;