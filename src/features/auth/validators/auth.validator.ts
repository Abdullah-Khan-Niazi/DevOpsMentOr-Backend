import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .email('Invalid email address.')
  .transform((v) => v.toLowerCase());

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(72);
const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain letters, numbers, underscores, periods, and hyphens');
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Code must be exactly 6 digits.');

const organizationSchema = z
  .object({
    name: z.string({ required_error: 'Organization name is required.' }).trim().min(2, 'Organization name must be at least 2 characters.').max(255),
    slug: z
      .string({ required_error: 'Organization slug is required.' })
      .trim()
      .min(2, 'Slug must be at least 2 characters.')
      .max(255)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with optional hyphens.'),
    description: z.string().trim().max(1000).optional().nullable(),
    website: z.string().trim().url('Enter a valid URL.').optional().nullable().or(z.literal('')),
    industry: z.string().trim().max(100).optional().nullable(),
    billingEmail: emailSchema.optional().nullable().or(z.literal('')),
  })
  .strip();

const baseSignupSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(100),
  countryCode: z.string().trim().min(2).max(2).optional().nullable(),
});

export const registerSchema = z
  .discriminatedUnion('accountType', [
    baseSignupSchema.extend({ accountType: z.literal('individual') }),
    baseSignupSchema.extend({ accountType: z.literal('organization'), organization: organizationSchema }),
    baseSignupSchema.extend({
      accountType: z.literal('member'),
      invitationCode: z.string().trim().min(1, 'Invitation code is required.'),
    }),
  ]);

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.').max(72),
    totpCode: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits.').optional().nullable().or(z.literal('')),
  })
  .strip();

export const verifyEmailSchema = z
  .object({
    email: emailSchema,
    code: otpSchema,
  })
  .strip();

export const resendVerificationSchema = z
  .object({
    email: emailSchema,
  })
  .strip();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strip();

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: otpSchema,
    newPassword: passwordSchema,
  })
  .strip();

export const setPasswordSchema = z
  .object({
    currentPassword: z.string().optional().nullable(),
    newPassword: passwordSchema,
  })
  .strip();

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required.'),
  })
  .strip();

export const logoutSchema = refreshTokenSchema;

export const oAuthLoginSchema = z
  .object({
    provider: z.enum(['google', 'github']),
    code: z.string().min(1, 'Authorization code is required.'),
    redirectUri: z.string().url('Invalid redirect URI.'),
  })
  .strip();

const optionalOAuthFullName = z
  .string()
  .trim()
  .max(100)
  .optional()
  .nullable()
  .transform((v) => (v && v.length >= 2 ? v : undefined));

const optionalOAuthUsername = z
  .string()
  .trim()
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]*$/, 'Username can only contain letters, numbers, underscores, periods, and hyphens')
  .optional()
  .nullable()
  .transform((v) => (v && v.length >= 3 ? v : undefined));

export const oAuthSignupSchema = oAuthLoginSchema.extend({
  username: optionalOAuthUsername,
  fullName: optionalOAuthFullName,
});

export const oAuthCompleteSchema = z
  .discriminatedUnion('accountType', [
    z.object({
      accountType: z.literal('individual'),
      pendingToken: z.string({ required_error: 'Missing OAuth session. Please sign in with your provider again.' }).min(1, 'Missing OAuth session.'),
      username: optionalOAuthUsername,
      fullName: optionalOAuthFullName,
    }).strip(),
    z.object({
      accountType: z.literal('organization'),
      pendingToken: z.string({ required_error: 'Missing OAuth session. Please sign in with your provider again.' }).min(1, 'Missing OAuth session.'),
      username: optionalOAuthUsername,
      fullName: optionalOAuthFullName,
      organization: organizationSchema,
    }).strip(),
    z.object({
      accountType: z.literal('member'),
      pendingToken: z.string({ required_error: 'Missing OAuth session. Please sign in with your provider again.' }).min(1, 'Missing OAuth session.'),
      username: optionalOAuthUsername,
      fullName: optionalOAuthFullName,
      invitationCode: z.string({ required_error: 'Invitation code is required.' }).trim().min(1, 'Invitation code is required.'),
    }).strip(),
  ]);

export const verify2faSchema = z
  .object({
    code: otpSchema,
    secret: z.string().min(16).optional(),
  })
  .strip();

export const enable2faSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/).optional(),
  })
  .strip();

export const adminLoginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.').max(72),
    totpCode: z.string().regex(/^\d{6}$/).optional().nullable().or(z.literal('')),
  })
  .strip();

export const adminInviteSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(100),
  })
  .strip();

export const acceptAdminInviteSchema = z
  .object({
    token: z.string().min(1, 'Invitation token is required.'),
    email: emailSchema,
    username: usernameSchema,
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(100),
    password: passwordSchema,
  })
  .strip();

export const createApiTokenSchema = z
  .object({
    tokenName: z.string().trim().min(1).max(100),
    expiresInDays: z.coerce.number().int().positive().max(365).optional(),
  })
  .strip();