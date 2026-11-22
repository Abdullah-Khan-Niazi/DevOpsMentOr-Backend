import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { CurriculumActor } from '../dto/curriculum.dto';
import { adminCurriculumService } from '../services/AdminCurriculumService';
import { moduleItemService } from '../services/ModuleItemService';
import { quizService } from '../services/QuizService';

function actorFrom(req: Request): CurriculumActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/** F4 Platform Admin write path: CRUD, publish/archive, reorder (§08, contracts 6.1). */
export class AdminCurriculumController {
  /* ── Reference data ─────────────────────────────────────────────────── */

  async getTags(_req: Request, res: Response): Promise<Response> {
    const tags = await adminCurriculumService.listTags();
    return sendSuccess(res, tags, 'Tags retrieved successfully.');
  }

  async listDifficulties(_req: Request, res: Response): Promise<Response> {
    const difficulties = await adminCurriculumService.listDifficulties();
    return sendSuccess(res, difficulties, 'Difficulties retrieved successfully.');
  }

  async listCategories(_req: Request, res: Response): Promise<Response> {
    const categories = await adminCurriculumService.listCategories();
    return sendSuccess(res, categories, 'Categories retrieved successfully.');
  }

  /* ── Courses ────────────────────────────────────────────────────────── */

  async listCourses(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { search?: string; status?: 'all' | 'published' | 'draft' };
    const courses = await adminCurriculumService.listCourses({ search: query.search, status: query.status });
    return sendSuccess(res, courses, 'Courses retrieved successfully.');
  }

  async createCourse(req: Request, res: Response): Promise<Response> {
    const course = await adminCurriculumService.createCourse(actorFrom(req), req.body);
    return sendSuccess(res, course, 'Course created successfully.', HTTP_STATUS.CREATED);
  }

  async getCourse(req: Request, res: Response): Promise<Response> {
    const courseId = Number(req.params.courseId);
    const [course, modules] = await Promise.all([
      adminCurriculumService.getCourse(courseId),
      adminCurriculumService.listCourseModules(courseId, {}),
    ]);
    return sendSuccess(res, { course, modules }, 'Course retrieved successfully.');
  }

  async updateCourse(req: Request, res: Response): Promise<Response> {
    const course = await adminCurriculumService.updateCourse(
      actorFrom(req),
      Number(req.params.courseId),
      req.body,
    );
    return sendSuccess(res, course, 'Course updated successfully.');
  }

  async archiveCourse(req: Request, res: Response): Promise<Response> {
    const course = await adminCurriculumService.archiveCourse(actorFrom(req), Number(req.params.courseId));
    return sendSuccess(res, course, 'Course archived successfully.');
  }

  async deleteCourse(req: Request, res: Response): Promise<Response> {
    await adminCurriculumService.deleteCourse(actorFrom(req), Number(req.params.courseId));
    return sendSuccess(res, null, 'Course deleted.');
  }

  /* ── Modules ────────────────────────────────────────────────────────── */

  /** D17: course scoped module list. */
  async listCourseModules(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { search?: string; isPublished?: boolean };
    const modules = await adminCurriculumService.listCourseModules(Number(req.params.courseId), {
      search: query.search,
      isPublished: query.isPublished,
    });
    return sendSuccess(res, modules, 'Modules retrieved successfully.');
  }

  async createModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.createModule(
      actorFrom(req),
      Number(req.params.courseId),
      req.body,
    );
    return sendSuccess(res, module, 'Module created successfully.', HTTP_STATUS.CREATED);
  }

  async reorderModules(req: Request, res: Response): Promise<Response> {
    const modules = await adminCurriculumService.reorderModules(
      actorFrom(req),
      Number(req.params.courseId),
      req.body.moduleIds,
    );
    return sendSuccess(res, modules, 'Module order updated successfully.');
  }

  /** Module editor payload: `{ module, items }`. */
  async getModule(req: Request, res: Response): Promise<Response> {
    const data = await adminCurriculumService.getModule(Number(req.params.moduleId));
    return sendSuccess(res, data, 'Module retrieved successfully.');
  }

  async updateModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.updateModule(actorFrom(req), Number(req.params.moduleId), req.body);
    return sendSuccess(res, module, 'Module updated successfully.');
  }

  async publishModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.publishModule(actorFrom(req), Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module published successfully.');
  }

  async archiveModule(req: Request, res: Response): Promise<Response> {
    const module = await adminCurriculumService.archiveModule(actorFrom(req), Number(req.params.moduleId));
    return sendSuccess(res, module, 'Module archived successfully.');
  }

  async deleteModule(req: Request, res: Response): Promise<Response> {
    await adminCurriculumService.deleteModule(actorFrom(req), Number(req.params.moduleId));
    return sendSuccess(res, null, 'Module deleted.');
  }

  /* ── Items ──────────────────────────────────────────────────────────── */

  async createItem(req: Request, res: Response): Promise<Response> {
    const item = await moduleItemService.createItem(actorFrom(req), Number(req.params.moduleId), req.body);
    return sendSuccess(res, item, 'Item created successfully.', HTTP_STATUS.CREATED);
  }

  async reorderItems(req: Request, res: Response): Promise<Response> {
    const items = await moduleItemService.reorderItems(actorFrom(req), Number(req.params.moduleId), req.body.itemIds);
    return sendSuccess(res, items, 'Item order updated successfully.');
  }

  async updateItemTitle(req: Request, res: Response): Promise<Response> {
    const item = await moduleItemService.updateItemTitle(actorFrom(req), Number(req.params.itemId), req.body.title);
    return sendSuccess(res, item, 'Item updated successfully.');
  }

  async publishItem(req: Request, res: Response): Promise<Response> {
    const item = await moduleItemService.publishItem(actorFrom(req), Number(req.params.itemId), req.body.isPublished);
    return sendSuccess(res, item, req.body.isPublished ? 'Item published successfully.' : 'Item unpublished successfully.');
  }

  async deleteItem(req: Request, res: Response): Promise<Response> {
    await moduleItemService.deleteItem(actorFrom(req), Number(req.params.itemId));
    return sendSuccess(res, null, 'Item deleted.');
  }

  /* ── Lessons ────────────────────────────────────────────────────────── */

  async getLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.getLesson(Number(req.params.lessonId));
    return sendSuccess(res, lesson, 'Lesson retrieved successfully.');
  }

  async updateLesson(req: Request, res: Response): Promise<Response> {
    const lesson = await adminCurriculumService.updateLesson(actorFrom(req), Number(req.params.lessonId), req.body);
    return sendSuccess(res, lesson, 'Lesson updated successfully.');
  }

  /** Alias of the item publish route with `isPublished: true`. */
  async publishLesson(req: Request, res: Response): Promise<Response> {
    const item = await moduleItemService.publishItem(actorFrom(req), Number(req.params.lessonId), true);
    return sendSuccess(res, item, 'Lesson published successfully.');
  }

  /* ── Quizzes and questions ──────────────────────────────────────────── */

  async getQuiz(req: Request, res: Response): Promise<Response> {
    const quiz = await quizService.getQuiz(Number(req.params.quizId));
    return sendSuccess(res, quiz, 'Quiz retrieved successfully.');
  }

  async updateQuiz(req: Request, res: Response): Promise<Response> {
    const quiz = await quizService.updateQuiz(actorFrom(req), Number(req.params.quizId), req.body);
    return sendSuccess(res, quiz, 'Quiz updated successfully.');
  }

  async deleteQuiz(req: Request, res: Response): Promise<Response> {
    await quizService.deleteQuiz(actorFrom(req), Number(req.params.quizId));
    return sendSuccess(res, null, 'Quiz deleted.');
  }

  async createQuestion(req: Request, res: Response): Promise<Response> {
    const { question, warnings } = await quizService.createQuestion(
      actorFrom(req),
      Number(req.params.quizId),
      req.body,
    );
    // `QuestionDto` plus the non-blocking authoring warnings.
    return sendSuccess(res, { ...question, warnings }, 'Question created successfully.', HTTP_STATUS.CREATED);
  }

  async reorderQuestions(req: Request, res: Response): Promise<Response> {
    const questions = await quizService.reorderQuestions(
      actorFrom(req),
      Number(req.params.quizId),
      req.body.questionIds,
    );
    return sendSuccess(res, questions, 'Question order updated successfully.');
  }

  async updateQuestion(req: Request, res: Response): Promise<Response> {
    const { question, warnings } = await quizService.updateQuestion(
      actorFrom(req),
      Number(req.params.questionId),
      req.body,
    );
    return sendSuccess(res, { ...question, warnings }, 'Question updated successfully.');
  }

  async deleteQuestion(req: Request, res: Response): Promise<Response> {
    await quizService.deleteQuestion(actorFrom(req), Number(req.params.questionId));
    return sendSuccess(res, null, 'Question deleted.');
  }
}

export const adminCurriculumController = new AdminCurriculumController();
