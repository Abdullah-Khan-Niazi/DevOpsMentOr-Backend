import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizeAnyPermissions, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { progressController } from '../controllers/ProgressController';
import { quizAttemptController } from '../controllers/QuizAttemptController';
import {
  activityQuerySchema,
  classIdParamSchema,
  classStudentsQuerySchema,
  completeLessonSchema,
  lessonIdParamSchema,
  orgIdParamSchema,
  quizIdParamSchema,
  submitQuizAttemptSchema,
  userIdParamSchema,
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

/** F5-API-01 */
selfRoutes.post(
  '/lessons/:lessonId/start',
  authorizePermissions(PERMISSIONS.PROGRESS_SELF_WRITE),
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.startLesson(req, res)),
);

/** F5-API-02 */
selfRoutes.patch(
  '/lessons/:lessonId/complete',
  authorizePermissions(PERMISSIONS.PROGRESS_SELF_WRITE),
  validateRequest(lessonIdParamSchema, 'params'),
  validateRequest(completeLessonSchema, 'body'),
  asyncHandler((req, res) => progressController.completeLesson(req, res)),
);

/** F5-API-03 */
selfRoutes.get('/course', asyncHandler((req, res) => progressController.getCourseProgress(req, res)));

/** F5-API-04 */
selfRoutes.get('/modules', asyncHandler((req, res) => progressController.getModulesProgress(req, res)));

/** F5-API-05 */
selfRoutes.get('/continue', asyncHandler((req, res) => progressController.getContinueLearning(req, res)));

/** F5-API-06 */
selfRoutes.get(
  '/activity',
  validateRequest(activityQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getActivityHistory(req, res)),
);

/** SCR-F5-02 payload */
selfRoutes.get(
  '/quizzes/:quizId/questions',
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getQuestions(req, res)),
);

/** SCR-F5-02 header */
selfRoutes.get(
  '/quizzes/:quizId',
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getMeta(req, res)),
);

/** F5-API-07 */
selfRoutes.post(
  '/quizzes/:quizId/attempts',
  authorizePermissions(PERMISSIONS.PROGRESS_SELF_WRITE),
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(submitQuizAttemptSchema, 'body'),
  asyncHandler((req, res) => quizAttemptController.submit(req, res)),
);

/** F5-API-08 */
selfRoutes.get(
  '/quizzes/:quizId/attempts',
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => quizAttemptController.getHistory(req, res)),
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
  validateRequest(classStudentsQuerySchema, 'query'),
  asyncHandler((req, res) => progressController.getClassStudents(req, res)),
);

/** F5-API-10: professor / org-admin drill-down. */
progressRouter.get(
  '/class/:classId/students/:userId',
  authorizeAnyPermissions(PERMISSIONS.PROGRESS_CLASS_READ, PERMISSIONS.PROGRESS_ORG_READ),
  validateRequest(classIdParamSchema, 'params'),
  validateRequest(userIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getStudentDetail(req, res)),
);

/** F5-API-11: org-admin aggregate. */
progressRouter.get(
  '/org/:orgId/students',
  authorizePermissions(PERMISSIONS.PROGRESS_ORG_READ),
  validateRequest(orgIdParamSchema, 'params'),
  asyncHandler((req, res) => progressController.getOrgStudents(req, res)),
);

export { progressRouter };
