import { z } from 'zod';
import { UserStatus } from '../../../shared/constants';
import { paginationQuerySchema } from '../../../shared/validators';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address.').transform((v) => v.trim().toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must be at most 72 characters.'),
  firstName: z.string().trim().min(1, 'First name is required.').max(100),
  lastName: z.string().trim().min(1, 'Last name is required.').max(100),
  roleIds: z.array(z.string().uuid()).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    status: z.nativeEnum(UserStatus).optional(),
    roleIds: z.array(z.string().uuid()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(UserStatus).optional(),
});
