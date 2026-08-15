import { z } from 'zod';

/**
 * F5 §07 payload and param schemas. Body schemas use `.strict()` per the
 * contract so unknown keys are rejected outright (anti mass assignment);
 * route params are coerced and stripped.
 */

/** Route params */
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

export const classIdParamSchema = z
  .object({
    classId: z.coerce.number().int().positive(),
  })
  .strip();

export const orgIdParamSchema = z
  .object({
    orgId: z.coerce.number().int().positive(),
  })
  .strip();

export const userIdParamSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
  })
  .strip();

/** F5-API-02: PATCH /api/progress/lessons/:lessonId/complete */
export const completeLessonSchema = z
  .object({
    timeSpentSeconds: z.number().int().min(0).max(3600),
  })
  .strict();

/** F5-API-07: POST /api/progress/quizzes/:quizId/attempts */
export const submitQuizAttemptSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.number().int().positive(),
            answerId: z.number().int().positive().optional(),
            answerText: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1, 'At least one answer is required.'),
    timeTakenSeconds: z.number().int().min(0).max(7200),
  })
  .strict();

/** GET /api/progress/activity + admin activity paging. */
export const activityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** Professor/org class student list paging. */
export const classStudentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();
