import { z } from 'zod';

/**
 * F8 §07 payload, query and param schemas. Body schemas use `.strip()` so
 * unknown keys are discarded at the boundary (anti mass assignment / HPP),
 * while declared keys are validated strictly. Route params are coerced.
 */

/** OPS-01: inbox query (page, limit, unreadOnly). */
export const inboxQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  })
  .strip();

/** OPS-02: `PATCH /api/notifications/:id/read` route param. */
export const notificationIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-06: PUT /api/notifications/preferences payload. */
export const updatePreferencesSchema = z
  .object({
    type: z.enum([
      'system',
      'achievement',
      'badge',
      'mention',
      'comment',
      'like',
      'follow',
      'team_invite',
      'ctf',
      'event',
      'security',
    ]),
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    inAppEnabled: z.boolean(),
  })
  .strip()
  .refine((data) => data.emailEnabled || data.pushEnabled || data.inAppEnabled, {
    message: 'At least one notification channel must remain enabled.',
  });

/** OPS-08: `POST /api/announcements/:id/read` route param. */
export const announcementIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-21: POST /api/admin/announcements payload. */
export const createAnnouncementSchema = z
  .object({
    title: z.string().min(1).max(255),
    content: z.string().min(1).max(10000),
    announcementType: z.enum(['general', 'maintenance', 'feature', 'security', 'event']),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    isPublished: z.boolean().default(false),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strip();

/** OPS-22: PATCH /api/admin/announcements/:id payload. */
export const updateAnnouncementSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    content: z.string().min(1).max(10000).optional(),
    announcementType: z.enum(['general', 'maintenance', 'feature', 'security', 'event']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strip();

/** OPS-23: `PATCH /api/admin/announcements/:id/publish` route param. */
export const adminAnnouncementIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();