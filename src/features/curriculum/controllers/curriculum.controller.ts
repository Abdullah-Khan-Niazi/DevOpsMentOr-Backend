import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { OrgActor } from '../../orgs/dto/org.dto';
import { curriculumService } from '../services/CurriculumService';

function actorFrom(req: Request): OrgActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    roles: req.user?.roles ?? [],
  };
}

/** F4 learner read path: published curriculum content only (§08). */
export class CurriculumController {
  /** Every published course with module and item counts. */
  async listCourses(_req: Request, res: Response): Promise<Response> {
    const courses = await curriculumService.listCourses();
    return sendSuccess(res, courses, 'Courses retrieved successfully.');
  }

  /** Course outline with the caller's access state. */
  async getCourseDetail(req: Request, res: Response): Promise<Response> {
    const detail = await curriculumService.getCourseDetail(actorFrom(req), Number(req.params.courseId));
    return sendSuccess(res, detail, 'Course retrieved successfully.');
  }

  async listCourseModules(req: Request, res: Response): Promise<Response> {
    const modules = await curriculumService.listCourseModules(Number(req.params.courseId));
    return sendSuccess(res, modules, 'Modules retrieved successfully.');
  }

  /** F4-API-03 */
  async getModuleById(req: Request, res: Response): Promise<Response> {
    const module = await curriculumService.getModule(Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module retrieved successfully.');
  }

  async listModuleItems(req: Request, res: Response): Promise<Response> {
    const items = await curriculumService.listModuleItems(Number(req.params.moduleId));
    return sendSuccess(res, items, 'Items retrieved successfully.');
  }

  /** F4-API-05 */
  async getLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await curriculumService.getLesson(actorFrom(req), Number(req.params.lessonId));
    return sendSuccess(res, lesson, 'Lesson retrieved successfully.');
  }
}

export const curriculumController = new CurriculumController();
