import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { CurriculumActor } from '../dto/curriculum.dto';
import { adminCurriculumService } from '../services/AdminCurriculumService';
import { quizService } from '../services/QuizService';

function actorFrom(req: Request): CurriculumActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/** F4 Platform Admin write path: CRUD, publish/archive, reorder (§08). */
export class AdminCurriculumController {
  /** F4-API-07 */
  async getCourse(_req: Request, res: Response): Promise<Response> {
    const course = await adminCurriculumService.getCourse();
    return sendSuccess(res, course, 'Course retrieved successfully.');
  }

  /** SCR-F4-03: lesson tag vocabulary for the editor form. */
  async getTags(_req: Request, res: Response): Promise<Response> {
    const tags = await adminCurriculumService.getTags();
    return sendSuccess(res, tags, 'Tags retrieved successfully.');
  }

  /** F4-API-08 */
  async updateCourse(req: Request, res: Response): Promise<Response> {
    const course = await adminCurriculumService.updateCourse(actorFrom(req), req.body);
    return sendSuccess(res, course, 'Course updated successfully.');
  }

  /** F4-API-09 + SCR-F4-02/03/04 editor payload when a module id is given. */
  async getModules(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { search?: string; isPublished?: boolean };
    const modules = await adminCurriculumService.getAllModules(query.search, query.isPublished);
    return sendSuccess(res, modules, 'Modules retrieved successfully.');
  }

  /** SCR-F4-02/03/04: module editor payload (module + lessons + quizzes). */
  async getModuleEditorData(req: Request, res: Response): Promise<Response> {
    const data = await adminCurriculumService.getModuleEditorData(Number(req.params.moduleId));
    return sendSuccess(res, data, 'Module editor data retrieved successfully.');
  }

  /** F4-API-10 */
  async createModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.createModule(actorFrom(req), req.body);
    return sendSuccess(res, module, 'Module created successfully.', HTTP_STATUS.CREATED);
  }

  /** F4-API-11 */
  async updateModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.updateModule(actorFrom(req), Number(req.params.moduleId), req.body);
    return sendSuccess(res, module, 'Module updated successfully.');
  }

  /** F4-API-12 */
  async publishModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.publishModule(actorFrom(req), Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module published successfully.');
  }

  /** F4-API-13 */
  async archiveModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.archiveModule(actorFrom(req), Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module archived successfully.');
  }

  /** F4-API-14 */
  async reorderModules(req: Request, res: Response): Promise<Response> {
    await adminCurriculumService.reorderModules(actorFrom(req), req.body.orders);
    return sendSuccess(res, null, 'Module order updated successfully.');
  }

  /** F4-API-15 */
  async createLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.createLesson(
      actorFrom(req),
      Number(req.params.moduleId),
      req.body,
    );
    return sendSuccess(res, lesson, 'Lesson created successfully.', HTTP_STATUS.CREATED);
  }

  /** F4-API-16 */
  async updateLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.updateLesson(actorFrom(req), Number(req.params.lessonId), req.body);
    return sendSuccess(res, lesson, 'Lesson updated successfully.');
  }

  /** F4-API-17 */
  async publishLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.publishLesson(actorFrom(req), Number(req.params.lessonId));
    return sendSuccess(res, lesson, 'Lesson published successfully.');
  }

  /** F4-API-18 */
  async reorderLessons(req: Request, res: Response): Promise<Response> {
    await adminCurriculumService.reorderLessons(
      actorFrom(req),
      Number(req.params.moduleId),
      req.body.orders,
    );
    return sendSuccess(res, null, 'Lesson order updated successfully.');
  }

  /** SCR-F4-03: single lesson for the editor form. */
  async getLessonEditorData(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.getLessonEditorData(Number(req.params.lessonId));
    return sendSuccess(res, lesson, 'Lesson retrieved successfully.');
  }

  /** F4-API-19 */
  async createQuiz(req: Request, res: Response): Promise<Response> {
    const quiz = await quizService.createQuiz(actorFrom(req), Number(req.params.moduleId), req.body);
    return sendSuccess(res, quiz, 'Quiz created successfully.', HTTP_STATUS.CREATED);
  }

  /** F4-API-20 */
  async updateQuiz(req: Request, res: Response): Promise<Response> {
    const quiz = await quizService.updateQuiz(actorFrom(req), Number(req.params.quizId), req.body);
    return sendSuccess(res, quiz, 'Quiz updated successfully.');
  }

  /** SCR-F4-04: single quiz with questions for the builder form. */
  async getQuizEditorData(req: Request, res: Response): Promise<Response> {
    const quiz = await quizService.getQuizAdminDetail(Number(req.params.quizId));
    return sendSuccess(res, quiz, 'Quiz retrieved successfully.');
  }

  /** F4-API-21 */
  async createQuestion(req: Request, res: Response): Promise<Response> {
    const question = await quizService.createQuestion(actorFrom(req), Number(req.params.quizId), req.body);
    return sendSuccess(res, question, 'Question created successfully.', HTTP_STATUS.CREATED);
  }

  /** F4-API-22 */
  async updateQuestion(req: Request, res: Response): Promise<Response> {
    const question = await quizService.updateQuestion(
      actorFrom(req),
      Number(req.params.questionId),
      req.body,
    );
    return sendSuccess(res, question, 'Question updated successfully.');
  }
}

export const adminCurriculumController = new AdminCurriculumController();
