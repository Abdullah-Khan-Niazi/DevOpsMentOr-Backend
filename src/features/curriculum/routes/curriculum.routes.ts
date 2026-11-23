import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { curriculumController } from '../controllers/curriculum.controller';
import {
  courseIdParamSchema,
  lessonIdParamSchema,
  moduleIdParamSchema,
} from '../validators/curriculum.validator';

/**
 * F4 §07 learner read routes (contracts 4.2): published content only. Outline
 * reads return 200 for any published course; content reads enforce course access.
 */
const curriculumRoutes = Router();

curriculumRoutes.use(authenticate, authorizePermissions(PERMISSIONS.CURRICULUM_READ));

/** Published course catalog. */
curriculumRoutes.get('/courses', asyncHandler((req, res) => curriculumController.listCourses(req, res)));

curriculumRoutes.get(
  '/courses/:courseId',
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getCourseDetail(req, res)),
);

curriculumRoutes.get(
  '/courses/:courseId/resources',
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getCourseResources(req, res)),
);

curriculumRoutes.get(
  '/courses/:courseId/modules',
  validateRequest(courseIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.listCourseModules(req, res)),
);

curriculumRoutes.get(
  '/modules/:moduleId',
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getModuleById(req, res)),
);

curriculumRoutes.get(
  '/modules/:moduleId/items',
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.listModuleItems(req, res)),
);

curriculumRoutes.get(
  '/lessons/:lessonId',
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getLesson(req, res)),
);

export { curriculumRoutes };
