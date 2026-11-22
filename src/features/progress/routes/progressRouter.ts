import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import {
  authenticate,
  authorizeAnyPermissions,
  authorizePermissions,
  rateLimit,
  validateRequest,
} from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { progressController } from '../controllers/ProgressController';
import { quizAttemptController } from '../controllers/QuizAttemptController';
import {
  activityQuerySchema,
  attemptIdParamSchema,
  attemptQuestionParamSchema,
  classIdParamSchema,
  classStudentParamSchema,
  classStudentsQuerySchema,
  completeLessonSchema,
  courseIdParamSchema,
  emptyBodySchema,
  lessonIdParamSchema,
  moduleIdParamSchema,
  orgIdParamSchema,
  quizIdParamSchema,
  staffCourseQuerySchema,
  submitQuizAnswerSchema,
  terminalStageBodySchema,
} from '../validators/progress.validator';

/** F5 §07 self-service + scoped progress read routes (§08 flow). */
const progressRouter = Router();

progressRouter.use(authenticate);

/** Self-service routes: every mutation and read is scoped to the session
 * user (BOLA: `WHERE user_id = session.userId` at the service layer). */
const selfRoutes = Router();
selfRoutes.use(
  authorizePermissions(PERMISSIONS.PROGRESS_SELF_READ, PERMISSIONS.PROGRESS_SELF_WRITE),
);

const selfRead = authorizePermissions(PERMISSIONS.PROGRESS_SELF_READ);
const selfWrite = authorizePermissions(PERMISSIONS.PROGRESS_SELF_WRITE);

/** F5-API-01 */
selfRoutes.post(
  '/lessons/:lessonId/start',
  selfWrite,
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.startLesson(req, res)),
);

/** F5-API-02 */
selfRoutes.patch(
  '/lessons/:lessonId/complete',
  selfWrite,
  validateRequest(lessonIdParamSchema, 'params'),
  validateRequest(completeLessonSchema, 'body'),
  asyncHandler((req, res) => progressController.completeLesson(req, res)),
);

/** Started published courses with their progress. */
selfRoutes.get('/courses', selfRead, asyncHandler((req, res) => progressController.listCourses(req, res)));

/** F5-API-03 */
selfRoutes.get(
  '/courses/:courseId',
  selfRead,
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getCourseProgress(req, res)),
);

/** F5-API-04 */
selfRoutes.get(
  '/courses/:courseId/modules',
  selfRead,
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getCourseModules(req, res)),
);

selfRoutes.get(
  '/modules/:moduleId/items',
  selfRead,
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getModuleItems(req, res)),
);

/** F5-API-05 */
selfRoutes.get('/continue', selfRead, asyncHandler((req, res) => progressController.getContinueLearning(req, res)));

/** F5-API-06 */
selfRoutes.get(
  '/activity',
  selfRead,
  validateRequest(activityQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getActivityHistory(req, res)),
);

/* ── Quizzes and attempts (contracts 4.4) ─────────────────────────────── */

selfRoutes.get(
  '/quizzes/:quizId',
  selfRead,
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getStatus(req, res)),
);

/** F5-API-08 */
selfRoutes.get(
  '/quizzes/:quizId/attempts',
  selfRead,
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getHistory(req, res)),
);

selfRoutes.post(
  '/quizzes/:quizId/attempts/start',
  selfWrite,
  rateLimit({ windowSeconds: 60, max: 10, scope: 'quiz-start', keyBy: 'user', failClosed: true }),
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(emptyBodySchema, 'body'),
  asyncHandler((req, res) => quizAttemptController.start(req, res)),
);

selfRoutes.get(
  '/quiz-attempts/:attemptId',
  selfRead,
  validateRequest(attemptIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getAttempt(req, res)),
);

selfRoutes.post(
  '/quiz-attempts/:attemptId/questions/:questionId/stage',
  authorizePermissions(PERMISSIONS.PROGRESS_SELF_WRITE, PERMISSIONS.LABS_INSTANCE_CREATE),
  rateLimit({ windowSeconds: 60, max: 10, scope: 'quiz-terminal-stage', keyBy: 'user', failClosed: true }),
  validateRequest(attemptQuestionParamSchema, 'params'),
  validateRequest(terminalStageBodySchema, 'body'),
  asyncHandler((req, res) => quizAttemptController.stage(req, res)),
);

selfRoutes.post(
  '/quiz-attempts/:attemptId/answers',
  selfWrite,
  rateLimit({ windowSeconds: 60, max: 60, scope: 'quiz-answer', keyBy: 'user', failClosed: true }),
  validateRequest(attemptIdParamSchema, 'params'),
  validateRequest(submitQuizAnswerSchema, 'body'),
  asyncHandler((req, res) => quizAttemptController.answer(req, res)),
);

selfRoutes.post(
  '/quiz-attempts/:attemptId/complete',
  selfWrite,
  rateLimit({ windowSeconds: 60, max: 10, scope: 'quiz-complete', keyBy: 'user', failClosed: true }),
  validateRequest(attemptIdParamSchema, 'params'),
  validateRequest(emptyBodySchema, 'body'),
  asyncHandler((req, res) => quizAttemptController.complete(req, res)),
);

selfRoutes.get(
  '/quiz-attempts/:attemptId/review',
  selfRead,
  validateRequest(attemptIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.review(req, res)),
);

progressRouter.use(selfRoutes);

/** F5-API-09: professor class analytics. */
progressRouter.get(
  '/class/:classId/students',
  authorizeAnyPermissions(
    PERMISSIONS.PROGRESS_CLASS_READ,
    PERMISSIONS.PROGRESS_ORG_READ,
    PERMISSIONS.PLATFORM_PROGRESS_READ,
  ),
  validateRequest(classIdParamSchema, 'params'),
  validateRequest(classStudentsQuerySchema.merge(staffCourseQuerySchema), 'query'),
  asyncHandler((req, res) => progressController.getClassStudents(req, res)),
);

/** F5-API-10: professor / org-admin drill-down. */
progressRouter.get(
  '/class/:classId/students/:userId',
  authorizeAnyPermissions(PERMISSIONS.PROGRESS_CLASS_READ, PERMISSIONS.PROGRESS_ORG_READ),
  validateRequest(classStudentParamSchema, 'params'),
  validateRequest(staffCourseQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getStudentDetail(req, res)),
);

/** F5-API-11: org-admin aggregate. Professors must never read org-wide. */
progressRouter.get(
  '/org/:orgId/students',
  authorizePermissions(PERMISSIONS.PROGRESS_ORG_READ),
  validateRequest(orgIdParamSchema, 'params'),
  validateRequest(staffCourseQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getOrgStudents(req, res)),
);

export { progressRouter };
