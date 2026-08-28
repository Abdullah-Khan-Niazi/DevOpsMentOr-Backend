import { z } from 'zod';

/**
 * F8 §07 operations payload, query and param schemas. Body schemas use
 * `.strip()`; route params are coerced.
 */

/** OPS-09: `GET /api/events` query. */
export const listEventsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    upcomingOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? true : value === 'true')),
  })
  .strip();

/** OPS-10/11/12: `:eventId` route param. */
export const eventIdParamSchema = z
  .object({ eventId: z.coerce.number().int().positive() })
  .strip();

/** OPS-20: `:fileId` route param. */
export const fileIdParamSchema = z
  .object({ fileId: z.coerce.number().int().positive() })
  .strip();

/** OPS-24: `POST /api/admin/events` payload. */
export const createEventSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(10000).optional(),
    location: z.string().max(255).optional(),
    eventType: z.enum(['webinar', 'workshop', 'competition', 'conference', 'meetup']),
    startTime: z.string().datetime(),
    endTime: z.string().datetime().optional(),
    timezone: z.string().max(50).optional(),
    maxAttendees: z.coerce.number().int().min(0).default(0),
    isFree: z.boolean().default(true),
    price: z.coerce.number().min(0).default(0),
    registrationDeadline: z.string().datetime().optional(),
    bannerUrl: z.string().max(255).optional(),
    isActive: z.boolean().default(true),
  })
  .strip()
  .refine((data) => !data.endTime || new Date(data.endTime) > new Date(data.startTime), {
    message: 'endTime must be after startTime.',
    path: ['endTime'],
  });

/** OPS-25: `PATCH /api/admin/events/:id` payload. */
export const updateEventSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(10000).optional(),
    location: z.string().max(255).optional(),
    eventType: z.enum(['webinar', 'workshop', 'competition', 'conference', 'meetup']).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    timezone: z.string().max(50).optional(),
    maxAttendees: z.coerce.number().int().min(0).optional(),
    isFree: z.boolean().optional(),
    price: z.coerce.number().min(0).optional(),
    registrationDeadline: z.string().datetime().optional(),
    bannerUrl: z.string().max(255).optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

/** OPS-26: `GET /api/admin/events/:id/attendees` query. */
export const attendeesQuerySchema = z
  .object({
    status: z.enum(['registered', 'attended', 'cancelled', 'waitlisted']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** OPS-36: `PATCH /api/admin/email-templates/:id` payload. */
export const updateEmailTemplateSchema = z
  .object({
    subject: z.string().min(1).max(255).optional(),
    bodyHtml: z.string().min(1).optional(),
    bodyText: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strip();

/** OPS-35/36/37: `:id` route param (email templates). */
export const templateIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();

/** OPS-43: multipart admin file upload metadata query. */
export const uploadFileQuerySchema = z
  .object({
    isPublic: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? false : value === 'true')),
  })
  .strip();