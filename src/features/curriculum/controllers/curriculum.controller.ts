import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { curriculumService } from '../services/CurriculumService';

/** F4 learner read path: published curriculum content only (§08). */
export class CurriculumController {
  /** F4-API-01 */
  async getCourse(_req: Request, res: Response): Promise<Response> {
    const overview = await curriculumService.getCourse();
    return sendSuccess(res, overview, 'Course retrieved successfully.');
  }

  /** F4-API-02 */
  async getModules(_req: Request, res: Response): Promise<Response> {
    const modules = await curriculumService.getPublishedModules();
    return sendSuccess(res, modules, 'Modules retrieved successfully.');
  }

  /** F4-API-03 */
  async getModuleById(req: Request, res: Response): Promise<Response> {
    const module = await curriculumService.getPublishedModuleById(Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module retrieved successfully.');
  }

  /** F4-API-04 */
  async getModuleLessons(req: Request, res: Response): Promise<Response> {
    const lessons = await curriculumService.getPublishedLessons(Number(req.params.moduleId));
    return sendSuccess(res, lessons, 'Lessons retrieved successfully.');
  }

  /** F4-API-05 */
  async getLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await curriculumService.getPublishedLesson(Number(req.params.lessonId));
    return sendSuccess(res, lesson, 'Lesson retrieved successfully.');
  }

  /** F4-API-06 */
  async getModuleQuizzes(req: Request, res: Response): Promise<Response> {
    const quizzes = await curriculumService.getPublishedQuizzes(Number(req.params.moduleId));
    return sendSuccess(res, quizzes, 'Quizzes retrieved successfully.');
  }
}

export const curriculumController = new CurriculumController();
