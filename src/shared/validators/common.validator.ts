import { z } from 'zod';
import { COURSE_SLUG_RE, MODULE_SLUG_RE, ITEM_SLUG_RE } from '../utils/curriculum-slug';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid id format.'),
});

export const numberParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid id format.'),
});

/**
 * Stored, user-supplied URL (cover images, trailers, icons, evidence files).
 * `z.string().url()` alone accepts `javascript:` / `data:` URLs (D18), which
 * become XSS when rendered as a link or media source; only http(s) is allowed.
 * These URLs are never fetched server side.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .url('Use a valid URL.')
  .max(2048, 'URL is too long.')
  .refine((v) => /^https?:\/\//i.test(v), 'Use an http(s) URL.');

/** Curriculum course slug `Cxx`, e.g. `C01`. */
export const courseSlugSchema = z
  .string()
  .trim()
  .regex(COURSE_SLUG_RE, 'Use a course code such as C01.');

/** Curriculum module slug `CxxMxx`, e.g. `C01M03`. */
export const moduleSlugSchema = z
  .string()
  .trim()
  .regex(MODULE_SLUG_RE, 'Use a module code such as C01M03.');

/** Curriculum item slug `CxxMxxLxx`, e.g. `C01M03L01`. */
export const itemSlugSchema = z
  .string()
  .trim()
  .regex(ITEM_SLUG_RE, 'Use a slug such as C01M03L01.');

/** Positive integer route/query id (`:labId`, `:attemptId`, ...). */
export const positiveIdSchema = z.coerce.number().int().positive('Invalid id format.');

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;
export type UuidParamDto = z.infer<typeof uuidParamSchema>;
export type NumberParamDto = z.infer<typeof numberParamSchema>;
