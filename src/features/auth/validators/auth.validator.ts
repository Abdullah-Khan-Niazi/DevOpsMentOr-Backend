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