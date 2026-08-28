import { z } from 'zod';

/**
 * F6 §07 Zod schemas. All schemas `.strip()` (client-supplied extras dropped);
 * `content_type` values are restricted to `lab` | `course` — `machine` and
 * `challenge` are rejected with 422 (AC-09).
 */

const regionEnum = z.enum(['US', 'EU', 'ASIA', 'AUSTRALIA', 'SOUTH_AMERICA', 'AFRICA']);

export const labIdParamSchema = z
  .object({ labId: z.coerce.number().int().positive() })
  .strip();

export const trackIdParamSchema = z
  .object({ trackId: z.coerce.number().int().positive() })
  .strip();

export const instanceIdParamSchema = z
  .object({ instanceId: z.coerce.number().int().positive() })
  .strip();

/** LAB-03 */
export const provisionLabSchema = z
  .object({
    region: regionEnum.optional(),
  })
  .strip();

/** LAB-09 */
export const sherlockSubmitSchema = z
  .object({
    answers: z
      .array(z.object({ questionId: z.string().min(1), answer: z.string().min(1) }).strip())
      .min(1)
      .max(100),
  })
  .strip();

/** LAB-10 */
export const vpnConfigQuerySchema = z
  .object({
    region: regionEnum.optional(),
  })
  .strip();

/** LAB-11 */
export const aiMentorMessageSchema = z
  .object({
    message: z.string().min(1).max(2000),
    lessonId: z.number().int().positive(),
    labId: z.number().int().positive().optional(),
  })
  .strip();

/** LAB-11 */
export const aiMentorQuerySchema = z
  .object({
    lessonId: z.coerce.number().int().positive(),
    labId: z.coerce.number().int().positive().optional(),
  })
  .strip();

/** LAB-12 */
export const clearSessionSchema = z
  .object({
    lessonId: z.number().int().positive(),
  })
  .strip();

/** LAB-16 / LAB-17 */
const proLabConfigSchema = z
  .object({
    networkIpRange: z.string().max(64).optional(),
    totalMachines: z.number().int().min(1),
    requiredRootCount: z.number().int().min(1),
    flagValues: z.record(z.string()).optional(),
  })
  .strip();

const sherlockConfigSchema = z
  .object({
    evidenceFileUrl: z.string().url().optional(),
    evidenceFileSize: z.number().int().min(0).optional(),
    fileHash: z.string().max(128).optional(),
    questions: z
      .array(z.object({ id: z.string().min(1), text: z.string().min(1), hint: z.string().optional() }).strip())
      .min(1),
    answers: z.array(z.object({ id: z.string().min(1), answer: z.string() }).strip()).min(1),
    requiredCorrectAnswers: z.number().int().min(1),
  })
  .strip();

export const createLabSchema = z
  .object({
    labName: z.string().min(3).max(100),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/),
    description: z.string().max(5000).optional(),
    difficultyId: z.number().int().positive(),
    categoryId: z.number().int().positive().optional(),
    labType: z.enum(['pro_lab', 'sherlock', 'vip_lab']),
    isPremium: z.boolean().default(false),
    estimatedHours: z.number().int().min(0).default(0),
    networkDiagramUrl: z.string().url().optional(),
    proLabConfig: proLabConfigSchema.optional(),
    sherlockConfig: sherlockConfigSchema.optional(),
  })
  .strip()
  .refine((data) => data.labType !== 'pro_lab' || data.proLabConfig !== undefined, {
    message: 'proLabConfig is required for pro_lab labs.',
  })
  .refine((data) => data.labType !== 'sherlock' || data.sherlockConfig !== undefined, {
    message: 'sherlockConfig is required for sherlock labs.',
  });

export const updateLabSchema = z
  .object({
    labName: z.string().min(3).max(100).optional(),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(5000).nullable().optional(),
    difficultyId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    isPremium: z.boolean().optional(),
    estimatedHours: z.number().int().min(0).optional(),
    networkDiagramUrl: z.string().url().nullable().optional(),
    proLabConfig: proLabConfigSchema.nullable().optional(),
    sherlockConfig: sherlockConfigSchema.nullable().optional(),
  })
  .strip();

/** LAB-18 */
export const publishLabSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strip();

/** LAB-19 / LAB-20: AC-09 — machine/challenge content types are rejected. */
const trackContentSchema = z
  .object({
    contentType: z.enum(['lab', 'course']),
    contentId: z.number().int().positive(),
    displayOrder: z.number().int().min(0),
    required: z.boolean().default(true),
  })
  .strip();

export const createTrackSchema = z
  .object({
    trackName: z.string().min(3).max(100),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/),
    description: z.string().max(5000).optional(),
    difficultyId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    totalLabs: z.number().int().min(0).default(0),
    isPremium: z.boolean().default(false),
    content: z.array(trackContentSchema).max(200).optional(),
  })
  .strip();

export const updateTrackSchema = z
  .object({
    trackName: z.string().min(3).max(100).optional(),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(5000).nullable().optional(),
    difficultyId: z.number().int().positive().nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    totalLabs: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    isPremium: z.boolean().optional(),
    content: z.array(trackContentSchema).max(200).optional(),
  })
  .strip();

/** LAB-21 */
export const labInstancesQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending', 'running', 'stopped', 'terminated', 'error']).optional(),
    search: z.string().max(100).optional(),
  })
  .strip();

/** LAB-22 */
export const adminTerminateBodySchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strip();