import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address.').transform((v) => v.trim().toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must be at most 72 characters.'),
  firstName: z.string().trim().min(1, 'First name is required.').max(100),
  lastName: z.string().trim().min(1, 'Last name is required.').max(100),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address.').transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required.'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required.'),
});
