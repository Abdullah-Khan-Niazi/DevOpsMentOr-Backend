import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminCurriculumController } from '../controllers/admin-curriculum.controller';
import {
  adminModuleListQuerySchema,
  createLessonSchema,
  createModuleSchema,
  createQuestionSchema,
  createQuizSchema,
  lessonIdParamSchema,
  moduleIdParamSchema,
  questionIdParamSchema,
  quizIdParamSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  updateCourseSchema,
  updateLessonSchema,
  updateModuleSchema,
  updateQuestionSchema,
  updateQuizSchema,
} from '../validators/curriculum.validator';

/**
 * F4 §07 admin routes. Writes require `platform.curriculum.manage`; reads of
 * all states require `platform.curriculum.read`. `/modules/reorder` is
 * registered before `/modules/:moduleId` so the literal segment wins.
 */
const adminCurriculumRoutes = Router();

adminCurriculumRoutes.use(authenticate);

/** F4-API-07 */
adminCurriculumRoutes.get(
  '/curriculum/course',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  asyncHandler((req, res) => adminCurriculumController.getCourse(req, res)),
);

/** SCR-F4-03: lesson tag vocabulary for the editor form. */
adminCurriculumRoutes.get(
  '/curriculum/tags',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  asyncHandler((req, res) => adminCurriculumController.getTags(req, res)),
);

/** F4-API-08 */
adminCurriculumRoutes.patch(
  '/curriculum/course',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(updateCourseSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateCourse(req, res)),
);

/** F4-API-09 */
adminCurriculumRoutes.get(
  '/curriculum/modules',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  validateRequest(adminModuleListQuerySchema, 'query'),
  asyncHandler((req, res) => adminCurriculumController.getModules(req, res)),
);

/** F4-API-14: literal `/reorder` must precede `/:moduleId`. */
adminCurriculumRoutes.patch(
  '/curriculum/modules/reorder',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(reorderModulesSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.reorderModules(req, res)),
);

/** SCR-F4-02/03/04 editor payload (module + lessons + quizzes). */
adminCurriculumRoutes.get(
  '/curriculum/modules/:moduleId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getModuleEditorData(req, res)),
);

/** F4-API-10 */
adminCurriculumRoutes.post(
  '/curriculum/modules',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(createModuleSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createModule(req, res)),
);

/** F4-API-11 */
adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(updateModuleSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateModule(req, res)),
);

/** F4-API-12 */
adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/publish',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.publishModule(req, res)),
);

/** F4-API-13 */
adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/archive',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.archiveModule(req, res)),
);

/** F4-API-15 */
adminCurriculumRoutes.post(
  '/curriculum/modules/:moduleId/lessons',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(createLessonSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createLesson(req, res)),
);

/** F4-API-18: literal `/lessons/reorder` precedes `/:moduleId` segment. */
adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/lessons/reorder',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(reorderLessonsSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.reorderLessons(req, res)),
);

/** F4-API-19 */
adminCurriculumRoutes.post(
  '/curriculum/modules/:moduleId/quizzes',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(createQuizSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createQuiz(req, res)),
);

/** SCR-F4-03: lesson editor form payload. */
adminCurriculumRoutes.get(
  '/curriculum/lessons/:lessonId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getLessonEditorData(req, res)),
);

/** F4-API-16 */
adminCurriculumRoutes.patch(
  '/curriculum/lessons/:lessonId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(lessonIdParamSchema, 'params'),
  validateRequest(updateLessonSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateLesson(req, res)),
);

/** F4-API-17 */
adminCurriculumRoutes.patch(
  '/curriculum/lessons/:lessonId/publish',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.publishLesson(req, res)),
);

/** F4-API-20 */
adminCurriculumRoutes.patch(
  '/curriculum/quizzes/:quizId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(updateQuizSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateQuiz(req, res)),
);

/** SCR-F4-04: quiz builder payload (quiz + questions). */
adminCurriculumRoutes.get(
  '/curriculum/quizzes/:quizId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ),
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getQuizEditorData(req, res)),
);

/** F4-API-21 */
adminCurriculumRoutes.post(
  '/curriculum/quizzes/:quizId/questions',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(createQuestionSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createQuestion(req, res)),
);

/** F4-API-22 */
adminCurriculumRoutes.patch(
  '/curriculum/questions/:questionId',
  authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE),
  validateRequest(questionIdParamSchema, 'params'),
  validateRequest(updateQuestionSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateQuestion(req, res)),
);

export { adminCurriculumRoutes };
