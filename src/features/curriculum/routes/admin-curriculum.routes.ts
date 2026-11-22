import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { adminCurriculumController } from '../controllers/admin-curriculum.controller';
import {
  adminCourseListQuerySchema,
  adminModuleListQuerySchema,
  courseIdParamSchema,
  createCourseSchema,
  createModuleItemSchema,
  createModuleSchema,
  createQuestionSchema,
  itemIdParamSchema,
  lessonIdParamSchema,
  moduleIdParamSchema,
  questionIdParamSchema,
  quizIdParamSchema,
  reorderItemsSchema,
  reorderModulesSchema,
  reorderQuestionsSchema,
  updateCourseSchema,
  updateItemPublishSchema,
  updateItemTitleSchema,
  updateLessonSchema,
  updateModuleSchema,
  updateQuestionSchema,
  updateQuizSchema,
} from '../validators/curriculum.validator';

/**
 * F4 §07 admin routes (contracts 6.1). Writes require `platform.curriculum.manage`;
 * reads of all states require `platform.curriculum.read`. Literal `.../reorder`
 * segments are registered before their `/:id` siblings so the literal wins.
 */
const adminCurriculumRoutes = Router();

adminCurriculumRoutes.use(authenticate);

const read = authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_READ);
const manage = authorizePermissions(PERMISSIONS.PLATFORM_CURRICULUM_MANAGE);

/* ── Reference data ───────────────────────────────────────────────────── */

adminCurriculumRoutes.get(
  '/curriculum/tags',
  read,
  asyncHandler((req, res) => adminCurriculumController.getTags(req, res)),
);

adminCurriculumRoutes.get(
  '/curriculum/difficulties',
  read,
  asyncHandler((req, res) => adminCurriculumController.listDifficulties(req, res)),
);

adminCurriculumRoutes.get(
  '/curriculum/categories',
  read,
  asyncHandler((req, res) => adminCurriculumController.listCategories(req, res)),
);

/* ── Courses ──────────────────────────────────────────────────────────── */

adminCurriculumRoutes.get(
  '/curriculum/courses',
  read,
  validateRequest(adminCourseListQuerySchema, 'query'),
  asyncHandler((req, res) => adminCurriculumController.listCourses(req, res)),
);

adminCurriculumRoutes.post(
  '/curriculum/courses',
  manage,
  validateRequest(createCourseSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createCourse(req, res)),
);

adminCurriculumRoutes.get(
  '/curriculum/courses/:courseId',
  read,
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getCourse(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/courses/:courseId',
  manage,
  validateRequest(courseIdParamSchema, 'params'),
  validateRequest(updateCourseSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateCourse(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/courses/:courseId/archive',
  manage,
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.archiveCourse(req, res)),
);

adminCurriculumRoutes.delete(
  '/curriculum/courses/:courseId',
  manage,
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.deleteCourse(req, res)),
);

/* ── Modules ──────────────────────────────────────────────────────────── */

adminCurriculumRoutes.get(
  '/curriculum/courses/:courseId/modules',
  read,
  validateRequest(courseIdParamSchema, 'params'),
  validateRequest(adminModuleListQuerySchema, 'query'),
  asyncHandler((req, res) => adminCurriculumController.listCourseModules(req, res)),
);

adminCurriculumRoutes.post(
  '/curriculum/courses/:courseId/modules',
  manage,
  validateRequest(courseIdParamSchema, 'params'),
  validateRequest(createModuleSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createModule(req, res)),
);

// Literal `/modules/reorder` before any `/modules/:id` sibling.
adminCurriculumRoutes.patch(
  '/curriculum/courses/:courseId/modules/reorder',
  manage,
  validateRequest(courseIdParamSchema, 'params'),
  validateRequest(reorderModulesSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.reorderModules(req, res)),
);

adminCurriculumRoutes.get(
  '/curriculum/modules/:moduleId',
  read,
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getModule(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(updateModuleSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateModule(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/publish',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.publishModule(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/archive',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.archiveModule(req, res)),
);

adminCurriculumRoutes.delete(
  '/curriculum/modules/:moduleId',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.deleteModule(req, res)),
);

/* ── Items ────────────────────────────────────────────────────────────── */

adminCurriculumRoutes.post(
  '/curriculum/modules/:moduleId/items',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(createModuleItemSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createItem(req, res)),
);

// Literal `/items/reorder` before any `/items/:id` sibling.
adminCurriculumRoutes.patch(
  '/curriculum/modules/:moduleId/items/reorder',
  manage,
  validateRequest(moduleIdParamSchema, 'params'),
  validateRequest(reorderItemsSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.reorderItems(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/items/:itemId',
  manage,
  validateRequest(itemIdParamSchema, 'params'),
  validateRequest(updateItemTitleSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateItemTitle(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/items/:itemId/publish',
  manage,
  validateRequest(itemIdParamSchema, 'params'),
  validateRequest(updateItemPublishSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.publishItem(req, res)),
);

adminCurriculumRoutes.delete(
  '/curriculum/items/:itemId',
  manage,
  validateRequest(itemIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.deleteItem(req, res)),
);

/* ── Lessons ──────────────────────────────────────────────────────────── */

adminCurriculumRoutes.get(
  '/curriculum/lessons/:lessonId',
  read,
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getLesson(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/lessons/:lessonId',
  manage,
  validateRequest(lessonIdParamSchema, 'params'),
  validateRequest(updateLessonSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateLesson(req, res)),
);

/** Alias of `PATCH /items/:itemId/publish` with `isPublished: true`. */
adminCurriculumRoutes.patch(
  '/curriculum/lessons/:lessonId/publish',
  manage,
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.publishLesson(req, res)),
);

/* ── Quizzes and questions ────────────────────────────────────────────── */

adminCurriculumRoutes.get(
  '/curriculum/quizzes/:quizId',
  read,
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.getQuiz(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/quizzes/:quizId',
  manage,
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(updateQuizSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateQuiz(req, res)),
);

adminCurriculumRoutes.delete(
  '/curriculum/quizzes/:quizId',
  manage,
  validateRequest(quizIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.deleteQuiz(req, res)),
);

adminCurriculumRoutes.post(
  '/curriculum/quizzes/:quizId/questions',
  manage,
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(createQuestionSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.createQuestion(req, res)),
);

// Literal `/questions/reorder` before any `/questions/:id` sibling.
adminCurriculumRoutes.patch(
  '/curriculum/quizzes/:quizId/questions/reorder',
  manage,
  validateRequest(quizIdParamSchema, 'params'),
  validateRequest(reorderQuestionsSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.reorderQuestions(req, res)),
);

adminCurriculumRoutes.patch(
  '/curriculum/questions/:questionId',
  manage,
  validateRequest(questionIdParamSchema, 'params'),
  validateRequest(updateQuestionSchema, 'body'),
  asyncHandler((req, res) => adminCurriculumController.updateQuestion(req, res)),
);

adminCurriculumRoutes.delete(
  '/curriculum/questions/:questionId',
  manage,
  validateRequest(questionIdParamSchema, 'params'),
  asyncHandler((req, res) => adminCurriculumController.deleteQuestion(req, res)),
);

export { adminCurriculumRoutes };
