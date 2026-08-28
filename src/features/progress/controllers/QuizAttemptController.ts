import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { quizAttemptService } from '../services/QuizAttemptService';

/** F5 §08 HTTP handling for quiz attempt submission and history. */
export class QuizAttemptController {
  /** F5-API-07 */
  async submit(req: Request, res: Response): Promise<Response> {
    const result = await quizAttemptService.submitAttempt(
      Number(req.user?.sub),
      Number(req.params.quizId),
      req.body,
    );
    return sendSuccess(res, result, 'Quiz attempt submitted successfully.', 201);
  }

  /** F5-API-08 */
  async getHistory(req: Request, res: Response): Promise<Response> {
    const attempts = await quizAttemptService.getAttemptHistory(
      Number(req.user?.sub),
      Number(req.params.quizId),
    );
    return sendSuccess(res, attempts, 'Quiz attempt history retrieved successfully.');
  }

  /** SCR-F5-02 payload: learner-safe quiz questions. */
  async getQuestions(req: Request, res: Response): Promise<Response> {
    const questions = await quizAttemptService.getQuizQuestions(
      Number(req.user?.sub),
      Number(req.params.quizId),
    );
    return sendSuccess(res, questions, 'Quiz questions retrieved successfully.');
  }

  /** SCR-F5-02 header: quiz metadata. */
  async getMeta(req: Request, res: Response): Promise<Response> {
    const meta = await quizAttemptService.getQuizMeta(Number(req.params.quizId));
    return sendSuccess(res, meta, 'Quiz metadata retrieved successfully.');
  }
}

export const quizAttemptController = new QuizAttemptController();
