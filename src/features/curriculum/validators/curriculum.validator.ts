import { z } from 'zod';

/** F4 §07 payload schemas. Every schema strips unknown keys (anti mass
 * assignment) and coerces numeric route params. */

const contentTypes = ['text', 'video', 'interactive', 'lab'] as const;
export const questionTypes = ['multiple_choice', 'true_false', 'fill_blank', 'multiple_select'] as const;

/** Route params */
export const moduleIdParamSchema = z
  .object({
    moduleId: z.coerce.number().int().positive(),
  })
  .strip();

export const lessonIdParamSchema = z
  .object({
    lessonId: z.coerce.number().int().positive(),
  })
  .strip();

export const quizIdParamSchema = z
  .object({
    quizId: z.coerce.number().int().positive(),
  })
  .strip();

export const questionIdParamSchema = z
  .object({
    questionId: z.coerce.number().int().positive(),
  })
  .strip();

/** GET /api/admin/curriculum/modules query (F4 §02 admin filter) */
export const adminModuleListQuerySchema = z
  .object({
    search: z.string().max(100).optional(),
    isPublished: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strip();

/** F4-API-08: PATCH /api/admin/curriculum/course */
export const updateCourseSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    difficultyId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional().nullable(),
    coverImageUrl: z.string().url().max(255).optional().nullable(),
    videoTrailerUrl: z.string().url().max(255).optional().nullable(),
    estimatedHours: z.coerce.number().int().min(0).max(10000).optional(),
    isPublished: z.boolean().optional(),
    prerequisites: z.array(z.string().min(1).max(500)).max(50).optional().nullable(),
    learningObjectives: z.array(z.string().min(1).max(500)).max(50).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** F4-API-10: POST /api/admin/curriculum/modules */
export const createModuleSchema = z
  .object({
    title: z.string().min(3).max(255),
    description: z.string().max(2000).optional(),
    estimatedMinutes: z.coerce.number().int().min(1).max(600).optional(),
    moduleOrder: z.coerce.number().int().min(1),
  })
  .strip();

/** F4-API-11: PATCH /api/admin/curriculum/modules/:moduleId */
export const updateModuleSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    estimatedMinutes: z.coerce.number().int().min(1).max(600).optional(),
    moduleOrder: z.coerce.number().int().min(1).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** F4-API-14: PATCH /api/admin/curriculum/modules/reorder */
export const reorderModulesSchema = z
  .object({
    orders: z
      .array(
        z.object({
          moduleId: z.coerce.number().int().positive(),
          moduleOrder: z.coerce.number().int().min(1),
        }),
      )
      .min(1, 'Provide at least one module order.'),
  })
  .strip();

/** F4-API-15: POST /api/admin/curriculum/modules/:moduleId/lessons */
export const createLessonSchema = z
  .object({
    title: z.string().min(3).max(255),
    content: z.string().max(200000).optional(),
    contentType: z.enum(contentTypes).default('text'),
    videoUrl: z.string().url().max(255).optional().nullable(),
    videoDurationSeconds: z.coerce.number().int().min(1).max(86400).optional().nullable(),
    lessonOrder: z.coerce.number().int().min(1),
    tagIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  })
  .strip();

/** F4-API-16: PATCH /api/admin/curriculum/lessons/:lessonId */
export const updateLessonSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    content: z.string().max(200000).optional().nullable(),
    contentType: z.enum(contentTypes).optional(),
    videoUrl: z.string().url().max(255).optional().nullable(),
    videoDurationSeconds: z.coerce.number().int().min(1).max(86400).optional().nullable(),
    lessonOrder: z.coerce.number().int().min(1).optional(),
    isPublished: z.boolean().optional(),
    tagIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** F4-API-18: PATCH /api/admin/curriculum/modules/:moduleId/lessons/reorder */
export const reorderLessonsSchema = z
  .object({
    orders: z
      .array(
        z.object({
          lessonId: z.coerce.number().int().positive(),
          lessonOrder: z.coerce.number().int().min(1),
        }),
      )
      .min(1, 'Provide at least one lesson order.'),
  })
  .strip();

/** F4-API-19: POST /api/admin/curriculum/modules/:moduleId/quizzes */
export const createQuizSchema = z
  .object({
    title: z.string().min(3).max(255),
    description: z.string().max(2000).optional(),
    passingScore: z.coerce.number().int().min(0).max(100).default(70),
    timeLimitMinutes: z.coerce.number().int().min(1).max(600).optional().nullable(),
    isRequired: z.boolean().default(true),
  })
  .strip();

/** F4-API-20: PATCH /api/admin/curriculum/quizzes/:quizId */
export const updateQuizSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    passingScore: z.coerce.number().int().min(0).max(100).optional(),
    timeLimitMinutes: z.coerce.number().int().min(1).max(600).optional().nullable(),
    isRequired: z.boolean().optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

const answerInputSchema = z.object({
  answerText: z.string().min(1).max(2000),
  isCorrect: z.boolean().default(false),
  answerOrder: z.coerce.number().int().min(1),
});

/** F4-API-21: POST /api/admin/curriculum/quizzes/:quizId/questions */
export const createQuestionSchema = z
  .object({
    questionText: z.string().min(3).max(2000),
    questionType: z.enum(questionTypes).default('multiple_choice'),
    points: z.coerce.number().int().min(1).max(100).default(10),
    explanation: z.string().max(2000).optional().nullable(),
    questionOrder: z.coerce.number().int().min(1),
    answers: z.array(answerInputSchema).min(1, 'At least one answer is required.'),
  })
  .strip();

/** F4-API-22: PATCH /api/admin/curriculum/questions/:questionId */
export const updateQuestionSchema = z
  .object({
    questionText: z.string().min(3).max(2000).optional(),
    questionType: z.enum(questionTypes).optional(),
    points: z.coerce.number().int().min(1).max(100).optional(),
    explanation: z.string().max(2000).optional().nullable(),
    questionOrder: z.coerce.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
    answers: z.array(answerInputSchema).min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });
