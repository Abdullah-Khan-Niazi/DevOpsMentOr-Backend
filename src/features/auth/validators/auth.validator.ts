import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(50),

  email: z
    .string()
    .email('Invalid email address.')
    .transform((v) => v.trim().toLowerCase()),

  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72),

  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required.')
    .max(100),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email address.')
    .transform((v) => v.trim().toLowerCase()),

  password: z
    .string()
    .min(1, 'Password is required.')
    .max(72),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required.'),
});

export const oAuthLoginSchema = z.object({
  provider: z.enum(['google', 'github']),
  code: z.string().min(1, 'Authorization code is required.'),
  redirectUri: z.string().url('Invalid redirect URI.'),
});

export const oAuthSignupSchema = oAuthLoginSchema.extend({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(50),

  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required.')
    .max(100),
});
