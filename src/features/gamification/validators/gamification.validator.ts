import { z } from 'zod';

/**
 * F7 §07 payload, query and param schemas. Body schemas use `.strip()` so
 * unknown keys are discarded at the boundary (anti mass assignment / HPP),
 * while declared keys are validated strictly. Route params are coerced.
 */

/** Shared pagination query (page, limit). */
export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();

/* ── Route params ─────────────────────────────────────────────────────── */

export const badgeIdParamSchema = z
  .object({ badgeId: z.coerce.number().int().positive() })
  .strip();

export const achievementIdParamSchema = z
  .object({ achievementId: z.coerce.number().int().positive() })
  .strip();

export const seasonIdParamSchema = z
  .object({ seasonId: z.coerce.number().int().positive() })
  .strip();

export const certIdParamSchema = z
  .object({ certId: z.coerce.number().int().positive() })
  .strip();

export const classIdParamSchema = z
  .object({ classId: z.coerce.number().int().positive() })
  .strip();

export const orgIdParamSchema = z
  .object({ orgId: z.coerce.number().int().positive() })
  .strip();

export const certificateNumberParamSchema = z
  .object({
    certNumber: z.string().min(1).max(50).regex(/^[A-Za-z0-9-]+$/),
  })
  .strip();

export const countryCodeParamSchema = z
  .object({
    countryCode: z.string().length(2).toUpperCase(),
  })
  .strip();

/* ── Badge / achievement / season / points payloads ───────────────────── */

/** GAM-15: POST /api/admin/badges */
export const createBadgeSchema = z
  .object({
    badgeName: z.string().min(3).max(100),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/),
    description: z.string().max(1000).optional(),
    badgeType: z.enum(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'special']),
    iconUrl: z.string().url().optional(),
    pointsRequired: z.number().int().min(0).default(0),
    criteria: z
      .object({
        triggerType: z.enum([
          'course_complete',
          'lab_complete',
          'achievement_unlock',
          'manual',
          'points_threshold',
        ]),
        triggerValue: z.record(z.unknown()),
      })
      .optional(),
    isHidden: z.boolean().default(false),
  })
  .strip();

/** GAM-16: PATCH /api/admin/badges/:badgeId */
export const updateBadgeSchema = z
  .object({
    badgeName: z.string().min(3).max(100).optional(),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(1000).nullable().optional(),
    badgeType: z.enum(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'special']).optional(),
    iconUrl: z.string().url().nullable().optional(),
    pointsRequired: z.number().int().min(0).optional(),
    criteria: z
      .object({
        triggerType: z.enum([
          'course_complete',
          'lab_complete',
          'achievement_unlock',
          'manual',
          'points_threshold',
        ]),
        triggerValue: z.record(z.unknown()),
      })
      .nullable()
      .optional(),
    isHidden: z.boolean().optional(),
  })
  .strip();

/** GAM-17: POST /api/admin/achievements */
export const createAchievementSchema = z
  .object({
    name: z.string().min(3).max(100),
    description: z.string().max(1000).optional(),
    pointsAwarded: z.number().int().min(0).default(0),
    triggerType: z.enum(['lab_completions', 'course_completions', 'streak_days', 'points_balance']),
    triggerValue: z.record(z.unknown()),
    isActive: z.boolean().default(true),
  })
  .strip();

/** GAM-18: PATCH /api/admin/achievements/:achievementId */
export const updateAchievementSchema = z
  .object({
    name: z.string().min(3).max(100).optional(),
    description: z.string().max(1000).nullable().optional(),
    pointsAwarded: z.number().int().min(0).optional(),
    triggerType: z
      .enum(['lab_completions', 'course_completions', 'streak_days', 'points_balance'])
      .optional(),
    triggerValue: z.record(z.unknown()).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

/** GAM-19: POST /api/admin/seasons */
export const createSeasonSchema = z
  .object({
    seasonName: z.string().min(1).max(100),
    seasonNumber: z.number().int().positive(),
    description: z.string().max(1000).optional(),
    bannerUrl: z.string().url().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isActive: z.boolean().default(true),
  })
  .strip()
  .refine((data) => data.endDate > data.startDate, {
    message: 'endDate must be after startDate.',
    path: ['endDate'],
  });

/** GAM-20: PATCH /api/admin/seasons/:seasonId */
export const updateSeasonSchema = z
  .object({
    seasonName: z.string().min(1).max(100).optional(),
    seasonNumber: z.number().int().positive().optional(),
    description: z.string().max(1000).nullable().optional(),
    bannerUrl: z.string().url().nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    isActive: z.boolean().optional(),
    content: z
      .array(
        z
          .object({
            // DevOps Mentor only inserts `lab` season content (AC-09); any other
            // value (machine / challenge) is rejected at the Zod boundary with 422.
            contentType: z.literal('lab'),
            contentId: z.number().int().positive(),
            releaseOrder: z.number().int().min(0).default(0),
            isReleased: z.boolean().default(false),
          })
          .strip(),
      )
      .optional(),
  })
  .strip()
  .refine((data) => data.startDate === undefined || data.endDate === undefined || data.endDate > data.startDate, {
    message: 'endDate must be after startDate.',
    path: ['endDate'],
  });

/** GAM-21: POST /api/admin/gamification/points/adjust */
export const pointsAdjustSchema = z
  .object({
    targetUserId: z.number().int().positive(),
    pointsChange: z.number().int().refine((value) => value !== 0, 'pointsChange must be non-zero'),
    description: z.string().min(5).max(500),
  })
  .strip();
