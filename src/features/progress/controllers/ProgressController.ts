import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { progressService, type ProgressActor } from '../services/ProgressService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

function actorFrom(req: Request): ProgressActor {
  return {
    userId: userId(req),
    permissions: req.user?.permissions ?? [],
    roles: req.user?.roles ?? [],
  };
}

/** Optional `?courseId` of the staff views (validated by `staffCourseQuerySchema`). */
function selectedCourseId(req: Request): number | undefined {
  return req.query.courseId === undefined ? undefined : Number(req.query.courseId);
}

/** F5 §08 HTTP handling for lesson progress and scoped reads. */
export class ProgressController {
  /** F5-API-01 */
  async startLesson(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.startLesson(
      userId(req),
      Number(req.params.lessonId),
      req.user?.roles ?? [],
    );
    return sendSuccess(res, progress, 'Lesson started successfully.');
  }

  /** F5-API-02 */
  async completeLesson(req: Request, res: Response): Promise<Response> {
    const result = await progressService.completeLesson(
      userId(req),
      Number(req.params.lessonId),
      req.body.timeSpentSeconds,
      req.user?.roles ?? [],
    );
    return sendSuccess(res, result, 'Lesson completed successfully.');
  }

  /** `GET /progress/courses`: started published courses. */
  async listCourses(req: Request, res: Response): Promise<Response> {
    const courses = await progressService.listCoursesProgress(userId(req));
    return sendSuccess(res, courses, 'Course progress retrieved successfully.');
  }

  /** F5-API-03 */
  async getCourseProgress(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.getCourseProgress(userId(req), Number(req.params.courseId));
    return sendSuccess(res, progress, 'Course progress retrieved successfully.');
  }

  /** F5-API-04 */
  async getCourseModules(req: Request, res: Response): Promise<Response> {
    const modules = await progressService.getCourseModulesProgress(userId(req), Number(req.params.courseId));
    return sendSuccess(res, modules, 'Module progress retrieved successfully.');
  }

  /** `GET /progress/modules/:moduleId/items` */
  async getModuleItems(req: Request, res: Response): Promise<Response> {
    const items = await progressService.getModuleItemsProgress(userId(req), Number(req.params.moduleId));
    return sendSuccess(res, items, 'Module item progress retrieved successfully.');
  }

  /** F5-API-05 */
  async getContinueLearning(req: Request, res: Response): Promise<Response> {
    const pointer = await progressService.getContinueLearning(userId(req));
    return sendSuccess(res, pointer, 'Continue learning pointer retrieved successfully.');
  }

  /** F5-API-06 */
  async getActivityHistory(req: Request, res: Response): Promise<Response> {
    const activity = await progressService.getActivityHistory(userId(req), Number(req.query.limit ?? 20));
    return sendSuccess(res, activity, 'Activity history retrieved successfully.');
  }

  /** F5-API-09 */
  async getClassStudents(req: Request, res: Response): Promise<Response> {
    const result = await progressService.getClassStudentsProgress(
      Number(req.params.classId),
      actorFrom(req),
      selectedCourseId(req),
    );
    return sendSuccess(res, result, 'Class progress retrieved successfully.');
  }

  /** F5-API-10 */
  async getStudentDetail(req: Request, res: Response): Promise<Response> {
    const result = await progressService.getStudentDetailProgress(
      Number(req.params.classId),
      Number(req.params.userId),
      actorFrom(req),
      selectedCourseId(req),
    );
    return sendSuccess(res, result, 'Student progress retrieved successfully.');
  }

  /** F5-API-11 */
  async getOrgStudents(req: Request, res: Response): Promise<Response> {
    const students = await progressService.getOrgStudentsProgress(
      Number(req.params.orgId),
      actorFrom(req),
      selectedCourseId(req),
    );
    return sendSuccess(res, students, 'Organization progress retrieved successfully.');
  }

  /** F5-API-12 */
  async getAdminUserProgress(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.getAdminUserProgress(Number(req.params.userId), selectedCourseId(req));
    return sendSuccess(res, progress, 'User progress retrieved successfully.');
  }
}

export const progressController = new ProgressController();
