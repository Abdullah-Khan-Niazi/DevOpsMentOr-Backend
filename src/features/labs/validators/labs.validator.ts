import { z } from 'zod';
import { httpUrlSchema } from '../../../shared/validators';
import { labSpecV2Schema, labStepCheckSchema } from './lab-spec.validator';

/**
 * F6 §07 Zod schemas. Learner and admin body schemas are strict where the
 * contract says so (contracts §4.1, §6.2); other schemas `.strip()`
 * client-supplied extras. `content_type` values are restricted to `lab` |
 * `course` (AC-09). Every URL field goes through `httpUrlSchema`.
 */

const regionEnum = z.enum(['US', 'EU', 'ASIA', 'AUSTRALIA', 'SOUTH_AMERICA', 'AFRICA']);

/** Lab step id (`LabStepV2.id`): lowercase letters, digits, "_" or "-". */
const stepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

/**
 * Lab slug: the Labs catalog key `CxxMxxLxx` for container labs (C1), or a
 * lowercase kebab slug for labs that have no catalog entry (Sherlock).
 */
const labSlugSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^(?:[a-z0-9-]+|C\d{2}M\d{2}L\d{2})$/, 'Use a catalog slug such as C01M03L01 or lowercase letters, numbers and "-".');

export const labIdParamSchema = z
  .object({ labId: z.coerce.number().int().positive() })
  .strip();

export const trackIdParamSchema = z
  .object({ trackId: z.coerce.number().int().positive() })
  .strip();

export const instanceIdParamSchema = z
  .object({ instanceId: z.coerce.number().int().positive() })
  .strip();

/** Learner step routes: `/labs/instances/:instanceId/steps/:stepId/...`. */
export const stepIdParamSchema = z
  .object({ stepId: stepIdSchema })
  .strip();

/** Learner hint reveal route: `/labs/:labId/steps/:stepId/hints/:hintIndex/reveal`. */
export const hintIndexParamSchema = z
  .object({ hintIndex: z.coerce.number().int().min(0).max(4) })
  .strip();

/** Learner step check body: the answer is only read for question steps. */
export const checkStepBodySchema = z
  .object({
    answer: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

/** Bodies that must be empty (`{}`), e.g. stage and hint reveal. */
export const emptyBodySchema = z.object({}).strict();

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

/**
 * LAB-11. Strict: the client sends only the message and optional context ids.
 * With neither id the mentor runs in GENERAL mode (personal dashboard).
 */
export const aiMentorMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    lessonId: z.number().int().positive().optional(),
    labId: z.number().int().positive().optional(),
  })
  .strict();

/** LAB-11 */
export const aiMentorQuerySchema = z
  .object({
    lessonId: z.coerce.number().int().positive().optional(),
    labId: z.coerce.number().int().positive().optional(),
  })
  .strip();

/** LAB-12 */
export const clearSessionSchema = z
  .object({
    lessonId: z.number().int().positive(),
  })
  .strip();

/** LAB-16 / LAB-17 (`flagValues` is gone: steps live in the v2 spec). */
const proLabConfigSchema = z
  .object({
    networkIpRange: z.string().max(64).optional(),
    totalMachines: z.number().int().min(1),
    requiredRootCount: z.number().int().min(1),
  })
  .strip();

const sherlockConfigSchema = z
  .object({
    evidenceFileUrl: httpUrlSchema.optional(),
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
    slug: labSlugSchema,
    description: z.string().max(5000).optional(),
    difficultyId: z.number().int().positive(),
    categoryId: z.number().int().positive().optional(),
    labType: z.enum(['pro_lab', 'sherlock', 'vip_lab']),
    isPremium: z.boolean().default(false),
    estimatedHours: z.number().int().min(0).default(0),
    networkDiagramUrl: httpUrlSchema.optional(),
    proLabConfig: proLabConfigSchema.optional(),
    sherlockConfig: sherlockConfigSchema.optional(),
    /** Optional initial step spec (kept for API completeness; the FE imports from the catalog). */
    spec: labSpecV2Schema.optional(),
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
    slug: labSlugSchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    difficultyId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    isPremium: z.boolean().optional(),
    estimatedHours: z.number().int().min(0).optional(),
    networkDiagramUrl: httpUrlSchema.nullable().optional(),
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

/** Admin: `POST /admin/labs/import` (C1/C2). */
export const importCatalogLabSchema = z
  .object({
    slug: z.string().regex(/^C\d{2}M\d{2}L\d{2}$/),
  })
  .strict();

/** Admin: `PUT /admin/labs/:labId/spec`. */
export const saveLabSpecSchema = z
  .object({
    spec: labSpecV2Schema,
  })
  .strict();

/** Admin: `POST /admin/labs/spec/validate` (live editor validation, never 422). */
export const validateLabSpecSchema = z
  .object({
    spec: z.unknown(),
  })
  .strict();

/**
 * Admin: `POST /admin/labs/:labId/test-check`. Exactly one of `stepId`
 * (evaluates the saved spec) or `check` (a draft check).
 */
export const testCheckSchema = z
  .object({
    instanceId: z.number().int().positive(),
    stepId: stepIdSchema.optional(),
    check: labStepCheckSchema.optional(),
  })
  .strict()
  .refine((value) => (value.stepId === undefined) !== (value.check === undefined), {
    message: 'Provide exactly one of stepId or check.',
  });

/** Admin: `POST /admin/tracks/:trackId/content` (append a course to the track). */
export const trackContentAttachSchema = z
  .object({
    courseId: z.number().int().positive(),
    required: z.boolean().default(true),
  })
  .strict();

/** Admin: `PATCH /admin/tracks/:trackId/content/:courseId`. */
export const trackContentPatchSchema = z
  .object({
    required: z.boolean(),
  })
  .strict();

/** Admin: `PATCH /admin/tracks/:trackId/content/reorder` (exact full set of course ids). */
export const trackContentReorderSchema = z
  .object({
    courseIds: z
      .array(z.number().int().positive())
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, 'Course ids must be unique.'),
  })
  .strict();

/**
 * Admin: `POST /admin/tracks`. `difficultyId` is required (NOT NULL column).
 * Strict: `content` and `totalLabs` are gone (courses attach through the
 * content routes; `totalLabs` is computed), so sending them is a 422.
 */
export const createTrackSchema = z
  .object({
    trackName: z.string().min(3).max(100),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/),
    description: z.string().max(5000).optional(),
    difficultyId: z.number().int().positive(),
    categoryId: z.number().int().positive().optional(),
    isPremium: z.boolean().default(false),
  })
  .strict();

/** Admin: `PATCH /admin/tracks/:trackId`. `difficultyId` is not nullable (NOT NULL column). Strict, like create. */
export const updateTrackSchema = z
  .object({
    trackName: z.string().min(3).max(100).optional(),
    slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(5000).nullable().optional(),
    difficultyId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    isPremium: z.boolean().optional(),
  })
  .strict();

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

/** Admin: `GET /admin/labs/catalog?unusedOnly=true|false`. */
export const catalogQuerySchema = z
  .object({
    unusedOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strip();

/** Admin: `/admin/tracks/:trackId/content/:courseId`. */
export const trackContentParamSchema = z
  .object({
    trackId: z.coerce.number().int().positive(),
    courseId: z.coerce.number().int().positive(),
  })
  .strip();

/** `/labs/instances/:instanceId/steps/:stepId/...` (one schema: `.strip()` drops keys of the others). */
export const instanceStepParamSchema = instanceIdParamSchema.merge(stepIdParamSchema);

/** `/labs/:labId/steps/:stepId/hints/:hintIndex/reveal`. */
export const hintRevealParamSchema = labIdParamSchema.merge(stepIdParamSchema).merge(hintIndexParamSchema);

/** `/labs/vpn/ovpn/:assignmentId`. */
export const assignmentIdParamSchema = z
  .object({ assignmentId: z.coerce.number().int().positive() })
  .strip();
