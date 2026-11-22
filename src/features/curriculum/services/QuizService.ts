import { db } from '../../../app/database';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import {
  ConflictError,
  ERROR_CODES,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { auditLogService } from '../../admin/services/audit-log.service';
import { labsRepository } from '../../labs/repositories/labs.repository';
import type {
  AnswerDto,
  CurriculumActor,
  QuestionConfigDto,
  QuestionDto,
  QuestionType,
  QuizDetailDto,
} from '../dto/curriculum.dto';
import {
  curriculumRepository,
  type AnswerRow,
  type DbOrTx,
  type QuestionRow,
  type QuizRow,
} from '../repositories/curriculum.repository';
import { checkQuestionShape } from '../validators/curriculum.validator';
import { toQuizBaseDto } from './CurriculumService';
import { curriculumSlugService } from './curriculum-slug.service';

/** Answer as accepted by the question write schema (`answerInputSchema`). */
export interface QuestionAnswerInput {
  answerText: string;
  isCorrect: boolean;
  answerOrder: number;
}

/** Question save result: the stored question plus non-blocking authoring warnings. */
export interface QuestionWriteResult {
  question: QuestionDto;
  warnings: string[];
}

export interface QuizServiceDeps {
  repo: typeof curriculumRepository;
  audit: typeof auditLogService;
  labs: typeof labsRepository;
}

function defaultDeps(): QuizServiceDeps {
  return { repo: curriculumRepository, audit: auditLogService, labs: labsRepository };
}

function quizNotFound(): NotFoundError {
  return new NotFoundError('Quiz not found.', [{ code: ERROR_CODES.QUIZ_NOT_FOUND }]);
}

function questionNotFound(): NotFoundError {
  return new NotFoundError('Question not found.');
}

/** Positions of a reorder body must be exactly the current child set (contracts §6.1). */
function assertExactReorderSet(requested: number[], existing: number[]): void {
  const existingIds = new Set(existing);
  const requestedIds = new Set(requested);
  const exact =
    requested.length === existing.length &&
    requestedIds.size === requested.length &&
    requested.every((id) => existingIds.has(id));
  if (!exact) {
    throw new ValidationError('The reorder list must contain every item exactly once.', [
      { code: ERROR_CODES.REORDER_SET_MISMATCH },
    ]);
  }
}

/**
 * Re-checks the per-type answer rules (contracts §6.1 "Answers per type") and the
 * config shape. The write schema applies the same rules; this keeps the service
 * authoritative for any other caller.
 */
function assertQuestionShape(
  questionType: QuestionType,
  config: Record<string, unknown> | null | undefined,
  answers: QuestionAnswerInput[],
): void {
  const { issues } = checkQuestionShape(questionType, config ?? null, answers);
  if (issues.length > 0) {
    throw new ValidationError(issues[0].message, [
      { code: ERROR_CODES.INVALID_ANSWER_SHAPE, issues },
    ]);
  }
}

/** Lab id of a terminal question's config, or null for every other question. */
function terminalLabIdOf(config: Record<string, unknown> | null | undefined): number | null {
  const terminal = config?.terminal as { labId?: unknown } | undefined;
  return typeof terminal?.labId === 'number' ? terminal.labId : null;
}

function crashAudit(
  audit: typeof auditLogService,
  actor: CurriculumActor,
  action: string,
  targetType: string,
  targetId: number | null,
  changes: Record<string, unknown> | null,
): void {
  void audit
    .record({
      adminUserId: actor.userId,
      action,
      targetType,
      targetId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    })
    .catch((err: unknown) => logger.warn({ err, action }, 'Audit write failed'));
}

/**
 * F4 §08 / C§6.1: quiz, question and answer administration. Every write runs in
 * one transaction. Wrong-answer and terminal guess penalties and the question
 * points are stored per question (`quiz_questions.config`, `points`); the
 * learner payload is built elsewhere (progress, D4).
 */
export class QuizService {
  constructor(private readonly deps: QuizServiceDeps = defaultDeps()) {}

  /** Admin quiz detail with every question and its correct answers. */
  async getQuiz(quizId: number): Promise<QuizDetailDto> {
    const quiz = await this.requireQuiz(quizId);
    return this.toQuizDetail(quiz);
  }

  /**
   * Updates quiz metadata. A title change is mirrored onto the quiz's item row
   * in the same transaction so the spine and the quiz never diverge.
   */
  async updateQuiz(
    actor: CurriculumActor,
    quizId: number,
    input: Partial<{
      title: string;
      description: string | null;
      passingScore: number;
      timeLimitMinutes: number | null;
      isRequired: boolean;
    }>,
  ): Promise<QuizDetailDto> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('description' in input) patch.description = input.description;
    if (input.passingScore !== undefined) patch.passingScore = input.passingScore;
    if ('timeLimitMinutes' in input) patch.timeLimitMinutes = input.timeLimitMinutes;
    if (input.isRequired !== undefined) patch.isRequired = input.isRequired;

    await db.transaction(async (tx) => {
      const quiz = await this.requireQuiz(quizId, tx);
      if (Object.keys(patch).length > 0) {
        await this.deps.repo.updateQuiz(quizId, patch, tx);
      }
      if (input.title !== undefined) {
        const spineRows = await this.spineRowsForQuiz(quiz, tx);
        for (const row of spineRows) {
          await this.deps.repo.updateLesson(row.lessonId, { title: input.title }, tx);
        }
      }
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_QUIZ, 'quiz', quizId, patch);
    return this.getQuiz(quizId);
  }

  /**
   * Hard delete of the quiz with its questions, answers and item row. Refused
   * while any attempt exists (409 `QUIZ_HAS_ATTEMPTS`). Sibling item orders are
   * compacted and the course counts refreshed.
   */
  async deleteQuiz(actor: CurriculumActor, quizId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const quiz = await this.requireQuiz(quizId, tx);
      if (await this.deps.repo.hasQuizLearnerData(quizId, tx)) {
        throw new ConflictError('This quiz has attempts and cannot be deleted.', [
          { code: ERROR_CODES.QUIZ_HAS_ATTEMPTS },
        ]);
      }
      const courseId = await this.courseIdOfModule(quiz.moduleId, tx);
      await this.deps.repo.deleteQuiz(quizId, tx);
      await this.compactItemOrders(quiz.moduleId, tx);
      await curriculumSlugService.recomputeCourse(tx, courseId);
      await this.deps.repo.refreshCourseCounts(courseId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_QUIZ, 'quiz', quizId, null);
  }

  /**
   * Creates a question with its answers. `questionOrder` defaults to append. A
   * terminal question's lab must exist (404 `LAB_NOT_FOUND`); a premium lab in a
   * free course is returned as a warning.
   */
  async createQuestion(
    actor: CurriculumActor,
    quizId: number,
    input: {
      questionText: string;
      questionType: QuestionType;
      config?: Record<string, unknown> | null;
      points: number;
      explanation: string | null;
      questionOrder?: number;
      answers: QuestionAnswerInput[];
    },
  ): Promise<QuestionWriteResult> {
    const result = await db.transaction(async (tx) => {
      const quiz = await this.requireQuiz(quizId, tx);
      assertQuestionShape(input.questionType, input.config, input.answers);
      const warnings =
        input.questionType === 'terminal'
          ? await this.terminalLabWarnings(quiz.moduleId, input.config, tx)
          : [];

      const questionOrder = input.questionOrder ?? (await this.nextQuestionOrder(quizId, tx));
      const questionId = await this.deps.repo.createQuestion(
        {
          quizId,
          questionText: input.questionText,
          questionType: input.questionType,
          config: input.config ?? null,
          points: input.points,
          explanation: input.explanation,
          questionOrder,
        },
        tx,
      );
      await this.deps.repo.replaceAnswers(questionId, input.answers, tx);

      const row = await this.requireQuestion(questionId, tx);
      return { questionId, question: await this.toQuestionDto(row, tx), warnings };
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_QUESTION, 'quiz_question', result.questionId, {
      quizId,
      questionType: input.questionType,
    });
    return { question: result.question, warnings: result.warnings };
  }

  /**
   * Updates a question. `questionType`, `config` and `answers` are re-validated
   * together and must be sent together. Changing the type of a question that has
   * learner answers is refused (409 `QUESTION_HAS_ANSWERS`).
   */
  async updateQuestion(
    actor: CurriculumActor,
    questionId: number,
    input: Partial<{
      questionText: string;
      questionType: QuestionType;
      config: Record<string, unknown> | null;
      points: number;
      explanation: string | null;
      isActive: boolean;
      answers: QuestionAnswerInput[];
    }>,
  ): Promise<QuestionWriteResult> {
    const shapeTouched =
      input.questionType !== undefined || input.config !== undefined || input.answers !== undefined;

    const patch: Record<string, unknown> = {};
    if (input.questionText !== undefined) patch.questionText = input.questionText;
    if (input.questionType !== undefined) patch.questionType = input.questionType;
    if (input.config !== undefined) patch.config = input.config;
    if (input.points !== undefined) patch.points = input.points;
    if ('explanation' in input) patch.explanation = input.explanation;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const result = await db.transaction(async (tx) => {
      const existing = await this.requireQuestion(questionId, tx);
      const quiz = await this.requireQuiz(existing.quizId, tx);

      let warnings: string[] = [];
      if (shapeTouched) {
        const { questionType, config, answers } = input;
        if (questionType === undefined || config === undefined || answers === undefined) {
          throw new ValidationError('questionType, config and answers must be sent together.', [
            { code: ERROR_CODES.INVALID_ANSWER_SHAPE },
          ]);
        }
        assertQuestionShape(questionType, config, answers);
        if (
          questionType !== existing.questionType &&
          (await this.deps.repo.hasQuestionLearnerData(questionId, tx))
        ) {
          throw new ConflictError(
            'This question has answers, so its type cannot change. Deactivate it and add a new question.',
            [{ code: ERROR_CODES.QUESTION_HAS_ANSWERS }],
          );
        }
        if (questionType === 'terminal') {
          warnings = await this.terminalLabWarnings(quiz.moduleId, config, tx);
        }
      }

      if (Object.keys(patch).length > 0) {
        await this.deps.repo.updateQuestion(questionId, patch, tx);
      }
      if (input.answers !== undefined) {
        await this.deps.repo.replaceAnswers(questionId, input.answers, tx);
      }

      const row = await this.requireQuestion(questionId, tx);
      return { question: await this.toQuestionDto(row, tx), warnings };
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_QUESTION, 'quiz_question', questionId, patch);
    return result;
  }

  /**
   * Hard delete of a question and its answers. Refused once learner answers exist
   * (409 `QUESTION_HAS_ANSWERS`); the admin deactivates the question instead.
   */
  async deleteQuestion(actor: CurriculumActor, questionId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const existing = await this.requireQuestion(questionId, tx);
      if (await this.deps.repo.hasQuestionLearnerData(questionId, tx)) {
        throw new ConflictError('This question has answers and cannot be deleted. Deactivate it instead.', [
          { code: ERROR_CODES.QUESTION_HAS_ANSWERS },
        ]);
      }
      await this.deps.repo.deleteQuestion(questionId, tx);
      await this.compactQuestionOrders(existing.quizId, tx);
    });
    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.DELETE_QUESTION, 'quiz_question', questionId, null);
  }

  /** Sets the question order to the given full list (422 `REORDER_SET_MISMATCH` otherwise). */
  async reorderQuestions(
    actor: CurriculumActor,
    quizId: number,
    questionIds: number[],
  ): Promise<QuestionDto[]> {
    const questions = await db.transaction(async (tx) => {
      await this.requireQuiz(quizId, tx);
      const existing = await this.deps.repo.listQuestionsByQuiz(quizId, true, tx);
      assertExactReorderSet(questionIds, existing.map((row) => row.questionId));

      await this.deps.repo.bulkUpdateQuestionOrders(
        quizId,
        questionIds.map((questionId, index) => ({ questionId, questionOrder: index + 1 })),
        tx,
      );
      const rows = await this.deps.repo.listQuestionsByQuiz(quizId, true, tx);
      const dtos: QuestionDto[] = [];
      for (const row of rows) {
        dtos.push(await this.toQuestionDto(row, tx));
      }
      return dtos;
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.REORDER_QUESTIONS, 'quiz', quizId, {
      questionIds,
    });
    return questions;
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */

  private async requireQuiz(quizId: number, tx: DbOrTx = db): Promise<QuizRow> {
    const quiz = await this.deps.repo.findQuizById(quizId, tx);
    if (!quiz) {
      throw quizNotFound();
    }
    return quiz;
  }

  private async requireQuestion(questionId: number, tx: DbOrTx = db): Promise<QuestionRow> {
    const question = await this.deps.repo.findQuestionById(questionId, tx);
    if (!question) {
      throw questionNotFound();
    }
    return question;
  }

  private async courseIdOfModule(moduleId: number, tx: DbOrTx): Promise<number> {
    const module = await this.deps.repo.findModuleById(moduleId, tx);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    return module.courseId;
  }

  /** The `lessons` item rows that point at this quiz (one per quiz). */
  private async spineRowsForQuiz(quiz: QuizRow, tx: DbOrTx) {
    const rows = await this.deps.repo.listLessonsByModule(quiz.moduleId, tx);
    return rows.filter((row) => row.quizId === quiz.quizId);
  }

  /** Re-numbers the module's item orders 1..n, skipping rows already in place. */
  private async compactItemOrders(moduleId: number, tx: DbOrTx): Promise<void> {
    const rows = await this.deps.repo.listLessonsByModule(moduleId, tx);
    const entries = rows
      .map((row, index) => ({ lessonId: row.lessonId, lessonOrder: index + 1, current: row.lessonOrder }))
      .filter((entry) => entry.current !== entry.lessonOrder)
      .map(({ lessonId, lessonOrder }) => ({ lessonId, lessonOrder }));
    await this.deps.repo.bulkUpdateLessonOrders(moduleId, entries, tx);
  }

  /** Re-numbers the quiz's question orders 1..n, skipping rows already in place. */
  private async compactQuestionOrders(quizId: number, tx: DbOrTx): Promise<void> {
    const rows = await this.deps.repo.listQuestionsByQuiz(quizId, true, tx);
    const entries = rows
      .map((row, index) => ({ questionId: row.questionId, questionOrder: index + 1, current: row.questionOrder }))
      .filter((entry) => entry.current !== entry.questionOrder)
      .map(({ questionId, questionOrder }) => ({ questionId, questionOrder }));
    await this.deps.repo.bulkUpdateQuestionOrders(quizId, entries, tx);
  }

  private async nextQuestionOrder(quizId: number, tx: DbOrTx): Promise<number> {
    const rows = await this.deps.repo.listQuestionsByQuiz(quizId, true, tx);
    return rows.reduce((max, row) => Math.max(max, row.questionOrder), 0) + 1;
  }

  /**
   * Non-blocking warnings for a terminal question's lab: the lab must exist
   * (404 `LAB_NOT_FOUND`); a premium lab placed in a free course is flagged.
   */
  private async terminalLabWarnings(
    moduleId: number,
    config: Record<string, unknown> | null | undefined,
    tx: DbOrTx,
  ): Promise<string[]> {
    const labId = terminalLabIdOf(config);
    if (labId === null) {
      return [];
    }
    const lab = await this.deps.labs.findLabById(labId);
    if (!lab) {
      throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
    }
    if (!lab.isPremium) {
      return [];
    }
    const courseId = await this.courseIdOfModule(moduleId, tx);
    const course = await this.deps.repo.findCourseById(courseId, tx);
    if (course && !course.isPremium) {
      return [
        `${lab.labName} is a premium lab, but this course is free. Learners without a premium plan cannot start its terminal.`,
      ];
    }
    return [];
  }

  private async toQuizDetail(quiz: QuizRow, tx: DbOrTx = db): Promise<QuizDetailDto> {
    const rows = await this.deps.repo.listQuestionsByQuiz(quiz.quizId, true, tx);
    const questions: QuestionDto[] = [];
    for (const row of rows) {
      questions.push(await this.toQuestionDto(row, tx));
    }
    return { ...toQuizBaseDto(quiz), questionCount: questions.length, questions };
  }

  private async toQuestionDto(row: QuestionRow, tx: DbOrTx = db): Promise<QuestionDto> {
    const answers = await this.deps.repo.listAnswersByQuestion(row.questionId, tx);
    return {
      questionId: row.questionId,
      quizId: row.quizId,
      questionText: row.questionText,
      questionType: row.questionType,
      config: (row.config ?? null) as QuestionConfigDto | null,
      points: row.points,
      explanation: row.explanation,
      questionOrder: row.questionOrder,
      isActive: row.isActive,
      answers: answers.map((answer: AnswerRow): AnswerDto => ({
        answerId: answer.answerId,
        questionId: answer.questionId,
        answerText: answer.answerText,
        isCorrect: answer.isCorrect,
        answerOrder: answer.answerOrder,
      })),
    };
  }
}

export const quizService = new QuizService();
