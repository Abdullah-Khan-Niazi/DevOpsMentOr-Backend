import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { progressService, type ProgressActor } from '../services/ProgressService';

function actorFrom(req: Request): ProgressActor {
  return {
    userId: Number(req.user?.sub),
    permissions: req.user?.permissions ?? [],
    roles: req.user?.roles ?? [],
  };
}

/** F5 §08 HTTP handling for lesson/quiz progress and scoped reads. */
export class ProgressController {
  /** F5-API-01 */
  async startLesson(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.startLesson(
      Number(req.user?.sub),
      Number(req.params.lessonId),
    );
    return sendSuccess(res, progress, 'Lesson started successfully.');
  }

  /** F5-API-02 */
  async completeLesson(req: Request, res: Response): Promise<Response> {
    const result = await progressService.completeLesson(
      Number(req.user?.sub),
      Number(req.params.lessonId),
      req.body.timeSpentSeconds,
    );
    return sendSuccess(res, result, 'Lesson completed successfully.');
  }

  /** F5-API-03 */
  async getCourseProgress(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.getCourseProgress(Number(req.user?.sub));
    return sendSuccess(res, progress, 'Course progress retrieved successfully.');
  }

  /** F5-API-04 */
  async getModulesProgress(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.getModulesProgress(Number(req.user?.sub));
    return sendSuccess(res, progress, 'Module progress retrieved successfully.');
  }

  /** F5-API-05 + §02 forward hook: getContinueLearningPointer. */
  async getContinueLearning(req: Request, res: Response): Promise<Response> {
    const pointer = await progressService.getContinueLearningPointer(Number(req.user?.sub));
    return sendSuccess(res, pointer, 'Continue learning pointer retrieved successfully.');
  }

  /** F5-API-06 */
  async getActivityHistory(req: Request, res: Response): Promise<Response> {
    const activity = await progressService.getActivityHistory(
      Number(req.user?.sub),
      Number(req.query.limit ?? 20),
    );
    return sendSuccess(res, activity, 'Activity history retrieved successfully.');
  }

  /** F5-API-09 */
  async getClassStudents(req: Request, res: Response): Promise<Response> {
    const result = await progressService.getClassStudentsProgress(
      Number(req.params.classId),
      actorFrom(req),
    );
    return sendSuccess(res, result, 'Class progress retrieved successfully.');
  }

  /** F5-API-10 */
  async getStudentDetail(req: Request, res: Response): Promise<Response> {
    const result = await progressService.getStudentDetailProgress(
      Number(req.params.classId),
      Number(req.params.userId),
      actorFrom(req),
    );
    return sendSuccess(res, result, 'Student progress retrieved successfully.');
  }

  /** F5-API-11 */
  async getOrgStudents(req: Request, res: Response): Promise<Response> {
    const students = await progressService.getOrgStudentsProgress(
      Number(req.params.orgId),
      actorFrom(req),
    );
    return sendSuccess(res, students, 'Organization progress retrieved successfully.');
  }

  /** F5-API-12 */
  async getAdminUserProgress(req: Request, res: Response): Promise<Response> {
    const progress = await progressService.getAdminUserProgress(Number(req.params.userId));
    return sendSuccess(res, progress, 'User progress retrieved successfully.');
  }
}

export const progressController = new ProgressController();
