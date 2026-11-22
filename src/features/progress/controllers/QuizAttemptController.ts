import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { quizAttemptService } from '../services/QuizAttemptService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

function roles(req: Request): string[] {
  return req.user?.roles ?? [];
}

/** F5 §08 HTTP handling for the server-created, one-question-at-a-time quiz attempts (contracts 4.4). */
export class QuizAttemptController {
  /** `GET /progress/quizzes/:quizId` */
  async getStatus(req: Request, res: Response): Promise<Response> {
    const status = await quizAttemptService.getStatus(userId(req), Number(req.params.quizId), roles(req));
    return sendSuccess(res, status, 'Quiz status retrieved successfully.');
  }

  /** `POST /progress/quizzes/:quizId/attempts/start`: 201 for a new attempt, 200 when resumed. */
  async start(req: Request, res: Response): Promise<Response> {
    const { attempt, resumed } = await quizAttemptService.start(userId(req), Number(req.params.quizId), roles(req));
    return sendSuccess(
      res,
      { attempt },
      resumed ? 'Quiz attempt resumed.' : 'Quiz attempt started.',
      resumed ? HTTP_STATUS.OK : HTTP_STATUS.CREATED,
    );
  }

  /** `GET /progress/quiz-attempts/:attemptId` */
  async getAttempt(req: Request, res: Response): Promise<Response> {
    const data = await quizAttemptService.getAttempt(userId(req), Number(req.params.attemptId), roles(req));
    return sendSuccess(res, data, 'Quiz attempt retrieved successfully.');
  }

  /** `POST /progress/quiz-attempts/:attemptId/questions/:questionId/stage` */
  async stage(req: Request, res: Response): Promise<Response> {
    const stage = await quizAttemptService.stageTerminal(
      userId(req),
      Number(req.params.attemptId),
      Number(req.params.questionId),
      req.body.region ?? null,
      roles(req),
    );
    return sendSuccess(res, { stage }, 'Terminal environment prepared.');
  }

  /** `POST /progress/quiz-attempts/:attemptId/answers` */
  async answer(req: Request, res: Response): Promise<Response> {
    const result = await quizAttemptService.submitAnswer(
      userId(req),
      Number(req.params.attemptId),
      req.body,
      roles(req),
    );
    return sendSuccess(res, { result }, 'Answer recorded.');
  }

  /** `POST /progress/quiz-attempts/:attemptId/complete` */
  async complete(req: Request, res: Response): Promise<Response> {
    const result = await quizAttemptService.complete(userId(req), Number(req.params.attemptId), roles(req));
    return sendSuccess(res, { result }, 'Quiz attempt completed.');
  }

  /** `GET /progress/quiz-attempts/:attemptId/review` */
  async review(req: Request, res: Response): Promise<Response> {
    const review = await quizAttemptService.getReview(userId(req), Number(req.params.attemptId), roles(req));
    return sendSuccess(res, { review }, 'Quiz review retrieved successfully.');
  }

  /** F5-API-08 */
  async getHistory(req: Request, res: Response): Promise<Response> {
    const attempts = await quizAttemptService.getAttemptHistory(userId(req), Number(req.params.quizId));
    return sendSuccess(res, attempts, 'Quiz attempt history retrieved successfully.');
  }
}

export const quizAttemptController = new QuizAttemptController();
