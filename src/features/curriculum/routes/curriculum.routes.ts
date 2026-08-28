import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import { curriculumController } from '../controllers/curriculum.controller';
import {
  lessonIdParamSchema,
  moduleIdParamSchema,
} from '../validators/curriculum.validator';

/** F4 §07 learner read routes: published content only (§08 flow). */
const curriculumRoutes = Router();

curriculumRoutes.use(authenticate, authorizePermissions(PERMISSIONS.CURRICULUM_READ));

/** F4-API-01 */
curriculumRoutes.get('/course', asyncHandler((req, res) => curriculumController.getCourse(req, res)));

/** F4-API-02 */
curriculumRoutes.get('/modules', asyncHandler((req, res) => curriculumController.getModules(req, res)));

/** F4-API-03 */
curriculumRoutes.get(
  '/modules/:moduleId',
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getModuleById(req, res)),
);

/** F4-API-04 */
curriculumRoutes.get(
  '/modules/:moduleId/lessons',
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getModuleLessons(req, res)),
);

/** F4-API-05 */
curriculumRoutes.get(
  '/lessons/:lessonId',
  validateRequest(lessonIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getLesson(req, res)),
);

/** F4-API-06 */
curriculumRoutes.get(
  '/modules/:moduleId/quizzes',
  validateRequest(moduleIdParamSchema, 'params'),
  asyncHandler((req, res) => curriculumController.getModuleQuizzes(req, res)),
);

export { curriculumRoutes };
