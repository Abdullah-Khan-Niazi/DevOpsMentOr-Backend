import { curriculumService } from '../../curriculum/services/CurriculumService';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type {
  QuizAttemptDto,
  QuizAttemptResultDto,
  QuizQuestionDto,
} from '../dto/progress.dto';
import type { ProgressRepository, QuestionWithAnswersRow } from '../repositories/progress.repository';
import { progressRepository } from '../repositories/progress.repository';
import { activityLogService } from './ActivityLogService';

export interface QuizAnswerInput {
  questionId: number;
  answerId?: number;
  answerText?: string;
}

export interface QuizAttemptServiceDeps {
  repo: ProgressRepository;
}

function defaultDeps(): QuizAttemptServiceDeps {
  return { repo: progressRepository };
}

/**
 * F5 quiz attempt engine: validates submitted question IDs against the quiz,
 * scores every question type (§05 rules 6-7), evaluates pass/fail against
 * `quizzes.passing_score`, and persists the attempt atomically with its
 * per-question answer rows.
 */
export class QuizAttemptService {
  constructor(private readonly deps: QuizAttemptServiceDeps = defaultDeps()) {}

  /** SCR-F5-02 header meta: title, time limit, passing score. */
  async getQuizMeta(quizId: number): Promise<{
    quizId: number;
    moduleId: number;
    title: string;
    passingScore: number;
    timeLimitMinutes: number | null;
  }> {
    const meta = await this.deps.repo.findQuizMeta(quizId);
    if (!meta) {
      throw new NotFoundError('Quiz not found.');
    }
    return meta;
  }

  /** F5-API-07: score and store one attempt. */
  async submitAttempt(
    userId: number,
    quizId: number,
    input: { answers: QuizAnswerInput[]; timeTakenSeconds: number },
  ): Promise<QuizAttemptResultDto> {
    const quiz = await curriculumService.getQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const [snapshot, module] = await Promise.all([
      curriculumService.getCourseSnapshot(),
      curriculumService.getModuleById(quiz.moduleId),
    ]);
    if (!module || module.courseId !== snapshot.courseId) {
      throw new ValidationError('Quiz does not belong to the canonical course.');
    }
    const quizQuestions = await this.deps.repo.listQuizQuestionsWithAnswers(quizId);
    if (quizQuestions.length === 0) {
      throw new NotFoundError('Quiz not found.');
    }

    const byQuestionId = new Map(quizQuestions.map((question) => [question.questionId, question]));
    for (const answer of input.answers) {
      if (!byQuestionId.has(answer.questionId)) {
        throw new ValidationError(`Question ${answer.questionId} does not belong to this quiz.`);
      }
    }

    if (quiz.timeLimitMinutes !== null && input.timeTakenSeconds > quiz.timeLimitMinutes * 60) {
      throw new ConflictError('Quiz time limit exceeded.');
    }

    const scored = this.scoreAttempt(quizQuestions, input.answers);
    const totalPoints = quizQuestions.reduce((sum, question) => sum + question.points, 0);
    const score = totalPoints > 0 ? Math.round((scored.pointsEarned / totalPoints) * 100) : 0;
    const isPassed = score >= quiz.passingScore;
    const attemptNumber = (await this.deps.repo.countQuizAttempts(userId, quizId)) + 1;

    const attemptId = await this.deps.repo.insertAttemptWithAnswers({
      userId,
      quizId,
      score,
      isPassed,
      attemptNumber,
      timeTakenSeconds: input.timeTakenSeconds,
      answers: scored.answers.map((answer) => ({
        questionId: answer.questionId,
        answerId: answer.selectedAnswerId,
        answerText: answer.selectedAnswerText,
        isCorrect: answer.isCorrect,
        pointsEarned: answer.pointsEarned,
      })),
    });

    await activityLogService.recordEvent(
      userId,
      isPassed ? 'QUIZ_PASSED' : 'QUIZ_FAILED',
      { quizId, attemptId, score, attemptNumber },
    );

    return {
      attemptId,
      score,
      isPassed,
      attemptNumber,
      correctCount: scored.answers.filter((answer) => answer.isCorrect).length,
      totalQuestions: quizQuestions.length,
      breakdown: scored.answers.map((answer) => ({
        questionId: answer.questionId,
        isCorrect: answer.isCorrect,
        pointsEarned: answer.pointsEarned,
        explanation: byQuestionId.get(answer.questionId)?.explanation ?? null,
      })),
    };
  }

  /** F5-API-08: learner's attempt history for one quiz. */
  async getAttemptHistory(userId: number, quizId: number): Promise<QuizAttemptDto[]> {
    const quiz = await curriculumService.getQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const rows = await this.deps.repo.listQuizAttemptsByQuiz(userId, quizId);
    return rows.map((row) => ({
      attemptId: row.attemptId,
      quizId,
      score: row.score,
      isPassed: row.isPassed,
      attemptNumber: row.attemptNumber,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      timeTakenSeconds: row.timeTakenSeconds,
    }));
  }

  /** SCR-F5-02 rendering payload: learner-safe questions (answers stripped). */
  async getQuizQuestions(userId: number, quizId: number): Promise<QuizQuestionDto[]> {
    const quiz = await curriculumService.getQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const rows = await this.deps.repo.listQuizQuestionsWithAnswers(quizId);
    if (rows.length > 0) {
      await activityLogService.recordEvent(userId, 'QUIZ_STARTED', { quizId });
    }
    return rows.map((row) => ({
      questionId: row.questionId,
      questionText: row.questionText,
      questionType: row.questionType as QuizQuestionDto['questionType'],
      points: row.points,
      questionOrder: row.questionOrder,
      answers: row.answers.map((answer) => ({
        answerId: answer.answerId,
        answerText: answer.answerText,
        answerOrder: answer.answerOrder,
      })),
    }));
  }

  /* ── §05 rules 6-7: question type scoring (pure, unit-testable) ─────── */

  scoreAttempt(
    questions: QuestionWithAnswersRow[],
    answers: QuizAnswerInput[],
  ): {
    pointsEarned: number;
    answers: Array<{
      questionId: number;
      selectedAnswerId: number | null;
      selectedAnswerText: string | null;
      isCorrect: boolean;
      pointsEarned: number;
    }>;
  } {
    let pointsEarned = 0;
    const results: Array<{
      questionId: number;
      selectedAnswerId: number | null;
      selectedAnswerText: string | null;
      isCorrect: boolean;
      pointsEarned: number;
    }> = [];

    for (const question of questions) {
      const submitted = answers.filter((answer) => answer.questionId === question.questionId);
      const correctAnswers = question.answers.filter((answer) => answer.isCorrect);
      const isCorrect = this.evaluateQuestion(question, submitted, correctAnswers);
      const earned = isCorrect ? question.points : 0;
      pointsEarned += earned;
      const primary = submitted[0];
      results.push({
        questionId: question.questionId,
        selectedAnswerId: primary?.answerId ?? null,
        selectedAnswerText: primary?.answerText ?? null,
        isCorrect,
        pointsEarned: earned,
      });
    }

    return { pointsEarned, answers: results };
  }

  private evaluateQuestion(
    question: QuestionWithAnswersRow,
    submitted: QuizAnswerInput[],
    correctAnswers: QuestionWithAnswersRow['answers'],
  ): boolean {
    switch (question.questionType) {
      case 'multiple_select': {
        const selected = submitted.map((answer) => answer.answerId).sort();
        const correct = correctAnswers.map((answer) => answer.answerId).sort();
        return selected.length > 0 && selected.length === correct.length &&
          selected.every((value, index) => value === correct[index]);
      }
      case 'fill_blank': {
        const submittedText = submitted
          .map((answer) => answer.answerText ?? '')
          .join(' ')
          .trim();
        return correctAnswers.some(
          (answer) => answer.answerText.trim().toLowerCase() === submittedText.toLowerCase(),
        );
      }
      default: {
        const selectedId = submitted[0]?.answerId ?? null;
        return correctAnswers.some((answer) => answer.answerId === selectedId);
      }
    }
  }
}

export const quizAttemptService = new QuizAttemptService();
