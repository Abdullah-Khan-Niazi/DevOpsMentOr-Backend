import { z } from 'zod';
import { CONTENT_DEFAULTS } from '../../gamification/config/content-defaults';
import { labStepCheckSchema } from '../../labs/validators/lab-spec.validator';
import { courseSlugSchema, httpUrlSchema } from '../../../shared/validators/common.validator';

/** F4 §07 payload schemas (contracts §6.1, §4.4, C§11.1-11.3). Body schemas are
 * strict (unknown keys are rejected); query and route-param schemas strip. */

/** Lesson-kind content types. Lab and quiz items have no content type of their own. */
const lessonContentTypes = ['text', 'video', 'interactive'] as const;

export const questionTypes = [
  'multiple_choice',
  'true_false',
  'fill_blank',
  'multiple_select',
  'bucket_sort',
  'ordering',
  'terminal',
] as const;

/**
 * Stored URL (cover images, trailers, lesson videos). Stored at most 255
 * characters (varchar(255)) and must be http(s) (D18, `httpUrlSchema`).
 */
const storedUrlSchema = z.string().max(255).pipe(httpUrlSchema);

/** Shared id list for reorder bodies: non-empty, positive ints, no duplicates. */
const uniqueIdListSchema = z
  .array(z.coerce.number().int().positive())
  .min(1, 'Provide at least one id.')
  .refine((ids) => new Set(ids).size === ids.length, 'Ids must be unique.');

/** Route params */
export const courseIdParamSchema = z
  .object({
    courseId: z.coerce.number().int().positive(),
  })
  .strip();

export const moduleIdParamSchema = z
  .object({
    moduleId: z.coerce.number().int().positive(),
  })
  .strip();

export const itemIdParamSchema = z
  .object({
    itemId: z.coerce.number().int().positive(),
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

/** GET /api/admin/curriculum/courses query */
export const adminCourseListQuerySchema = z
  .object({
    search: z.string().max(100).optional(),
    status: z.enum(['all', 'published', 'draft']).default('all'),
  })
  .strip();

/** GET /api/admin/curriculum/courses/:courseId/modules query (D17) */
export const adminModuleListQuerySchema = z
  .object({
    search: z.string().max(100).optional(),
    isPublished: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strip();

/** POST /api/admin/curriculum/courses — create a DRAFT course. The slug is
 * optional: the service assigns the lowest unused `Cxx` when it is omitted. */
export const createCourseSchema = z
  .object({
    title: z.string().min(3).max(255),
    slug: courseSlugSchema.optional(),
    description: z.string().max(2000).optional().nullable(),
    difficultyId: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive().optional().nullable(),
    estimatedHours: z.coerce.number().int().min(0).max(10000).optional(),
    isPremium: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/admin/curriculum/courses/:courseId */
export const updateCourseSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    slug: courseSlugSchema.optional(),
    description: z.string().max(2000).optional().nullable(),
    difficultyId: z.coerce.number().int().positive().optional(),
    categoryId: z.coerce.number().int().positive().optional().nullable(),
    coverImageUrl: storedUrlSchema.optional().nullable(),
    videoTrailerUrl: storedUrlSchema.optional().nullable(),
    estimatedHours: z.coerce.number().int().min(0).max(10000).optional(),
    isPublished: z.boolean().optional(),
    isPremium: z.boolean().optional(),
    prerequisites: z.array(z.string().min(1).max(500)).max(50).optional().nullable(),
    learningObjectives: z.array(z.string().min(1).max(500)).max(50).optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** POST /api/admin/curriculum/courses/:courseId/modules. `moduleOrder` is
 * optional: omitted means append (max + 1). */
export const createModuleSchema = z
  .object({
    title: z.string().min(3).max(255),
    description: z.string().max(2000).optional(),
    estimatedMinutes: z.coerce.number().int().min(1).max(600).optional(),
    moduleOrder: z.coerce.number().int().min(1).optional(),
  })
  .strict();

/** PATCH /api/admin/curriculum/modules/:moduleId (reorder is a separate route). */
export const updateModuleSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    estimatedMinutes: z.coerce.number().int().min(1).max(600).optional(),
    isPublished: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** PATCH /api/admin/curriculum/courses/:courseId/modules/reorder: exact full set. */
export const reorderModulesSchema = z
  .object({
    moduleIds: uniqueIdListSchema,
  })
  .strict();

/** Lesson branch of a module item. Lesson items get their slug from the server
 * (C§11.1), so this branch carries no `slug`. */
const lessonItemSchema = z
  .object({
    kind: z.literal('lesson'),
    title: z.string().trim().min(3).max(255),
    contentType: z.enum(lessonContentTypes),
    content: z.string().max(200000).optional(),
    videoUrl: storedUrlSchema.optional().nullable(),
    videoDurationSeconds: z.coerce.number().int().min(1).max(86400).optional().nullable(),
    tagIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  })
  .strict();

const labItemSchema = z
  .object({
    kind: z.literal('lab'),
    labId: z.number().int().positive(),
    title: z.string().trim().min(3).max(255).optional(),
  })
  .strict();

const quizItemSchema = z
  .object({
    kind: z.literal('quiz'),
    title: z.string().trim().min(3).max(255),
    description: z.string().max(2000).optional(),
    passingScore: z.coerce.number().int().min(0).max(100).default(70),
    timeLimitMinutes: z.coerce.number().int().min(1).max(600).optional().nullable(),
    isRequired: z.boolean().default(true),
  })
  .strict();

/** POST /api/admin/curriculum/modules/:moduleId/items. */
export const createModuleItemSchema = z.discriminatedUnion('kind', [
  lessonItemSchema,
  labItemSchema,
  quizItemSchema,
]);

/** PATCH /api/admin/curriculum/items/:itemId: the only edit for lab items (title override). */
export const updateItemTitleSchema = z
  .object({
    title: z.string().trim().min(3).max(255),
  })
  .strict();

/** PATCH /api/admin/curriculum/items/:itemId/publish */
export const updateItemPublishSchema = z
  .object({
    isPublished: z.boolean(),
  })
  .strict();

/** PATCH /api/admin/curriculum/modules/:moduleId/items/reorder: exact full set. */
export const reorderItemsSchema = z
  .object({
    itemIds: uniqueIdListSchema,
  })
  .strict();

/** PATCH /api/admin/curriculum/lessons/:lessonId: lesson items only (no slug,
 * no lessonOrder, no lab/quiz content types). */
export const updateLessonSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    content: z.string().max(200000).optional().nullable(),
    contentType: z.enum(lessonContentTypes).optional(),
    videoUrl: storedUrlSchema.optional().nullable(),
    videoDurationSeconds: z.coerce.number().int().min(1).max(86400).optional().nullable(),
    isPublished: z.boolean().optional(),
    tagIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/** PATCH /api/admin/curriculum/quizzes/:quizId (publish goes through item publish rules). */
export const updateQuizSchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    passingScore: z.coerce.number().int().min(0).max(100).optional(),
    timeLimitMinutes: z.coerce.number().int().min(1).max(600).optional().nullable(),
    isRequired: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

/* ── Quiz questions ─────────────────────────────────────────────────── */

/**
 * Penalties every question type carries inside `quiz_questions.config` (C3).
 * Integer points, 0..1000. `wrongPenalty` defaults to the authoring default;
 * `guessPenalty` defaults to 0 (terminal `answer` questions use the terminal
 * default instead, see `terminalQuestionConfigSchema`).
 */
export const questionPenaltySchema = {
  wrongPenalty: z.number().int().min(0).max(1000).default(CONTENT_DEFAULTS.quizWrongPenalty),
  guessPenalty: z.number().int().min(0).max(1000).default(0),
};

const instructionsSchema = z.string().max(2000).optional();

const answerInputSchema = z.object({
  answerText: z.string().min(1).max(2000),
  isCorrect: z.boolean().default(false),
  answerOrder: z.coerce.number().int().min(1),
});

const bucketSortConfigSchema = z
  .object({
    instructions: instructionsSchema,
    buckets: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
    ...questionPenaltySchema,
  })
  .strict();

const plainQuestionConfigSchema = z
  .object({
    instructions: instructionsSchema,
    ...questionPenaltySchema,
  })
  .strict();

/**
 * Terminal question config (C§4.4). `guessPenalty` is optional here because an
 * absent value means "use the default for the mode": `CONTENT_DEFAULTS.quizGuessPenalty`
 * for mode `answer` (a guess is possible), 0 for mode `check`.
 */
export const terminalQuestionConfigSchema = z
  .object({
    instructions: instructionsSchema,
    wrongPenalty: questionPenaltySchema.wrongPenalty,
    guessPenalty: z.number().int().min(0).max(1000).optional(),
    terminal: z
      .object({
        labId: z.number().int().positive(),
        mode: z.enum(['answer', 'check']),
        answerFormat: z.enum(['choice', 'text']).nullable().default(null),
        setup: z
          .array(z.string().min(1).max(4000).refine((value) => !value.includes('\u0000'), 'NUL bytes are not allowed.'))
          .max(10)
          .default([]),
        check: labStepCheckSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const { terminal } = config;
    if (terminal.mode === 'answer' && terminal.answerFormat === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal', 'answerFormat'],
        message: 'Choose an answer format (choice or text) for answer questions.',
      });
    }
    if (terminal.mode === 'check' && terminal.answerFormat !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal', 'answerFormat'],
        message: 'Check questions do not take an answer format.',
      });
    }
    if (terminal.mode === 'check' && !terminal.check) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal', 'check'],
        message: 'Check questions need a check.',
      });
    }
    if (terminal.mode === 'answer' && terminal.check) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminal', 'check'],
        message: 'Answer questions do not take a check.',
      });
    }
  })
  .transform((config) => ({
    ...config,
    guessPenalty:
      config.guessPenalty ??
      (config.terminal.mode === 'answer' ? CONTENT_DEFAULTS.quizGuessPenalty : 0),
  }));

/** Config schema per question type. Every type carries the penalty values. */
export const questionConfigSchemas = {
  multiple_choice: plainQuestionConfigSchema,
  true_false: plainQuestionConfigSchema,
  fill_blank: plainQuestionConfigSchema,
  multiple_select: plainQuestionConfigSchema,
  bucket_sort: bucketSortConfigSchema,
  ordering: plainQuestionConfigSchema,
  terminal: terminalQuestionConfigSchema,
} as const;

type QuestionType = (typeof questionTypes)[number];
type AnswerInput = z.infer<typeof answerInputSchema>;
type ShapeIssue = { path: Array<string | number>; message: string };

function countCorrect(answers: AnswerInput[]): number {
  return answers.filter((answer) => answer.isCorrect).length;
}

function sizeMessage(min: number, max: number): string {
  return `Add between ${min} and ${max} answers.`;
}

/**
 * Parses the config for a question type and checks the answers against the
 * type's rules (contracts §6.1 "Answers per type"). Issues are pathed `config`,
 * `config.*`, `answers` or `answers.N.field` so the frontend can map them.
 */
export function checkQuestionShape(
  questionType: QuestionType,
  rawConfig: unknown,
  answers: AnswerInput[],
): { config: Record<string, unknown>; issues: ShapeIssue[] } {
  const issues: ShapeIssue[] = [];
  const schema = questionConfigSchemas[questionType];
  const parsedConfig = schema.safeParse(rawConfig ?? {});
  if (!parsedConfig.success) {
    for (const issue of parsedConfig.error.issues) {
      issues.push({ path: ['config', ...issue.path], message: issue.message });
    }
  }
  const config = (parsedConfig.success ? parsedConfig.data : {}) as Record<string, unknown>;
  const count = answers.length;
  const correct = countCorrect(answers);

  const pushAnswersIssue = (message: string) => issues.push({ path: ['answers'], message });

  switch (questionType) {
    case 'multiple_choice':
      if (count < 2 || count > 10) pushAnswersIssue(sizeMessage(2, 10));
      if (correct !== 1) pushAnswersIssue('Exactly one answer must be correct.');
      break;
    case 'true_false':
      if (count !== 2) pushAnswersIssue('True/false questions need exactly 2 answers.');
      if (correct !== 1) pushAnswersIssue('Exactly one answer must be correct.');
      break;
    case 'multiple_select':
      if (count < 2 || count > 10) pushAnswersIssue(sizeMessage(2, 10));
      if (correct < 1) pushAnswersIssue('At least one answer must be correct.');
      break;
    case 'fill_blank':
      if (count < 1 || count > 20) pushAnswersIssue(sizeMessage(1, 20));
      answers.forEach((answer, index) => {
        if (!answer.isCorrect) {
          issues.push({ path: ['answers', index, 'isCorrect'], message: 'Every accepted answer must be correct.' });
        }
      });
      break;
    case 'ordering': {
      if (count < 2 || count > 20) pushAnswersIssue(sizeMessage(2, 20));
      const orders = answers.map((answer) => answer.answerOrder).sort((a, b) => a - b);
      const exact = orders.every((order, index) => order === index + 1);
      if (!exact) pushAnswersIssue('Answer order must run 1 to the number of answers without gaps.');
      break;
    }
    case 'bucket_sort': {
      if (count < 1 || count > 40) pushAnswersIssue(sizeMessage(1, 40));
      const buckets = Array.isArray(config.buckets) ? config.buckets.length : null;
      if (buckets !== null) {
        answers.forEach((answer, index) => {
          if (answer.answerOrder > buckets) {
            issues.push({
              path: ['answers', index, 'answerOrder'],
              message: `Bucket number must be between 1 and ${buckets}.`,
            });
          }
        });
      }
      break;
    }
    case 'terminal': {
      const terminal = config.terminal as { mode?: string; answerFormat?: string | null } | undefined;
      if (terminal?.mode === 'check') {
        if (count !== 0) pushAnswersIssue('Check questions take no answers.');
      } else if (terminal?.mode === 'answer' && terminal.answerFormat === 'choice') {
        if (count < 2 || count > 10) pushAnswersIssue(sizeMessage(2, 10));
        if (correct !== 1) pushAnswersIssue('Exactly one answer must be correct.');
      } else if (terminal?.mode === 'answer' && terminal.answerFormat === 'text') {
        if (count < 1 || count > 20) pushAnswersIssue(sizeMessage(1, 20));
        answers.forEach((answer, index) => {
          if (!answer.isCorrect) {
            issues.push({ path: ['answers', index, 'isCorrect'], message: 'Every accepted answer must be correct.' });
          }
        });
      }
      break;
    }
  }

  return { config, issues };
}

function addShapeIssues(
  issues: ShapeIssue[],
  ctx: z.RefinementCtx,
): void {
  for (const issue of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  }
}

/** POST /api/admin/curriculum/quizzes/:quizId/questions. `questionOrder` is
 * optional (append). `config` is always stored with its penalty values. */
export const createQuestionSchema = z
  .object({
    questionText: z.string().min(3).max(2000),
    questionType: z.enum(questionTypes).default('multiple_choice'),
    config: z.record(z.unknown()).nullable().optional(),
    points: z.coerce.number().int().min(1).max(100).default(10),
    explanation: z.string().max(2000).optional().nullable(),
    questionOrder: z.coerce.number().int().min(1).optional(),
    answers: z.array(answerInputSchema).max(40),
  })
  .strict()
  .transform((data, ctx) => {
    const { config, issues } = checkQuestionShape(data.questionType, data.config, data.answers);
    if (issues.length > 0) {
      addShapeIssues(issues, ctx);
      return z.NEVER;
    }
    return { ...data, config };
  });

/** PATCH /api/admin/curriculum/questions/:questionId. `questionOrder` is set
 * through the reorder route. When `questionType`, `config` or `answers` is sent,
 * all three must be sent and the whole triple is re-validated. */
export const updateQuestionSchema = z
  .object({
    questionText: z.string().min(3).max(2000).optional(),
    questionType: z.enum(questionTypes).optional(),
    config: z.record(z.unknown()).nullable().optional(),
    points: z.coerce.number().int().min(1).max(100).optional(),
    explanation: z.string().max(2000).optional().nullable(),
    isActive: z.boolean().optional(),
    answers: z.array(answerInputSchema).max(40).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  })
  .transform((data, ctx) => {
    const shapeKeys = ['questionType', 'config', 'answers'] as const;
    const touched = shapeKeys.some((key) => data[key] !== undefined);
    if (!touched) {
      return data;
    }
    const missing = shapeKeys.filter((key) => data[key] === undefined);
    if (missing.length > 0) {
      for (const key of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'questionType, config and answers must be sent together.',
        });
      }
      return z.NEVER;
    }
    const questionType = data.questionType as QuestionType;
    const { config, issues } = checkQuestionShape(
      questionType,
      data.config,
      data.answers as AnswerInput[],
    );
    if (issues.length > 0) {
      addShapeIssues(issues, ctx);
      return z.NEVER;
    }
    return { ...data, config };
  });

/** PATCH /api/admin/curriculum/quizzes/:quizId/questions/reorder: exact full set. */
export const reorderQuestionsSchema = z
  .object({
    questionIds: uniqueIdListSchema,
  })
  .strict();
