import { z } from 'zod';
import { USER_WRITABLE_SETTING_KEYS, UserStatus } from '../../../shared/constants';
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

// ─── F2 — Users / Profiles / Platform Administration ───────────────────────

/** USR-02 (F2 §07 UpdateProfileSchema). */
export const updateMyProfileSchema = z
  .object({
    fullName: z.string().min(2).max(100).optional(),
    displayName: z.string().min(1).max(50).optional(),
    bio: z.string().max(1000).optional(),
    countryId: z.number().int().positive().optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    occupation: z.string().max(100).optional().nullable(),
    company: z.string().max(100).optional().nullable(),
    website: z.string().url().max(255).optional().nullable(),
    githubUrl: z.string().url().max(255).optional().nullable(),
    linkedinUrl: z.string().url().max(255).optional().nullable(),
    twitterHandle: z.string().max(50).optional().nullable(),
    discordUsername: z.string().max(100).optional().nullable(),
    isPublic: z.boolean().optional(),
    timezone: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
  })
  .strip()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** USR-06: add a skill from the catalog. */
export const addMySkillSchema = z
  .object({
    skillId: z.number().int().positive(),
    proficiencyLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    yearsExperience: z.number().min(0).max(40).optional(),
  })
  .strip();

/** USR-07: route param `:skillId`. */
export const skillIdParamSchema = z.object({
  skillId: z.coerce.number().int().positive(),
});

/**
 * USR-09: settings UPSERT payload.
 *
 * Only explicitly user-writable preference keys are accepted. Server-owned
 * keys (`org_id`, workspace pointers, plans, roles) are rejected with an
 * actionable message instead of being written and silently ignored — a
 * client-writable `org_id` would let a user repoint their own organization
 * scope and cross tenant boundaries.
 */
export const updateMySettingsSchema = z
  .object({
    settings: z
      .array(
        z.object({
          key: z
            .string()
            .min(1)
            .max(100)
            .refine(
              (key) => (USER_WRITABLE_SETTING_KEYS as readonly string[]).includes(key),
              {
                message:
                  'This setting is managed by the platform and cannot be changed here. Only theme, timezone and notify_email can be updated.',
              },
            ),
          value: z.unknown(),
        }),
      )
      .min(1)
      .max(20),
  })
  .strip();

/** USR-10/11/12: route param `:userId`. */
export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});
