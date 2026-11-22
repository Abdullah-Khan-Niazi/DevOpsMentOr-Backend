import { z } from 'zod';
import type { VpnRegion } from '../../labs/dto/labs.dto';

/**
 * F5 §07 payload and param schemas. Body schemas use `.strict()` per the
 * contract so unknown keys are rejected outright (anti mass assignment);
 * route params are coerced and stripped.
 */

/** Every VPN region the labs feature accepts (must stay in step with `VpnRegion`). */
const vpnRegions = ['US', 'EU', 'ASIA', 'AUSTRALIA', 'SOUTH_AMERICA', 'AFRICA'] as const satisfies readonly VpnRegion[];

/** Route params */
export const lessonIdParamSchema = z
  .object({
    lessonId: z.coerce.number().int().positive(),
  })
  .strip();

export const moduleIdParamSchema = z
  .object({
    moduleId: z.coerce.number().int().positive(),
  })
  .strip();

export const courseIdParamSchema = z
  .object({
    courseId: z.coerce.number().int().positive(),
  })
  .strip();

export const attemptIdParamSchema = z
  .object({
    attemptId: z.coerce.number().int().positive(),
  })
  .strip();

export const questionIdParamSchema = z
  .object({
    questionId: z.coerce.number().int().positive(),
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
    timeSpentSeconds: z.number().int().min(0).max(86400),
  })
  .strict();

/** Body of PATCH/POST endpoints that take no fields (`{}` only). */
export const emptyBodySchema = z.object({}).strict();

/** POST /progress/quiz-attempts/:attemptId/questions/:questionId/stage */
export const terminalStageBodySchema = z
  .object({
    region: z.enum(vpnRegions).optional(),
  })
  .strict();

/** Staff class/student/admin views: optional selected course. */
export const staffCourseQuerySchema = z
  .object({
    courseId: z.coerce.number().int().positive().optional(),
  })
  .strip();

/** POST /progress/quiz-attempts/:attemptId/answers (one question per request). */
export const submitQuizAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  response: z.discriminatedUnion('type', [
    z.object({ type: z.literal('choice'), answerId: z.number().int().positive() }).strict(), // multiple_choice, true_false, terminal(choice)
    z.object({ type: z.literal('multi'), answerIds: z.array(z.number().int().positive()).min(1).max(20) }).strict(), // multiple_select
    z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(500) }).strict(), // fill_blank, terminal(text)
    z.object({ type: z.literal('ordering'), answerIds: z.array(z.number().int().positive()).min(2).max(20) }).strict(),
    z
      .object({
        type: z.literal('buckets'),
        placements: z
          .array(
            z
              .object({
                answerId: z.number().int().positive(),
                bucket: z.number().int().min(1).max(8),
              })
              .strict(),
          )
          .min(1)
          .max(40),
      })
      .strict(),
    z.object({ type: z.literal('terminal_check') }).strict(), // terminal(check)
  ]),
}).strict();

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

/** `/progress/quiz-attempts/:attemptId/questions/:questionId/stage` (one schema: `.strip()` drops other keys). */
export const attemptQuestionParamSchema = attemptIdParamSchema.merge(questionIdParamSchema);

/** `/progress/class/:classId/students/:userId`. */
export const classStudentParamSchema = classIdParamSchema.merge(userIdParamSchema);
