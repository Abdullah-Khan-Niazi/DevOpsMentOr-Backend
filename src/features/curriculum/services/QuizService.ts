import { AUDIT_ACTIONS } from '../../../shared/constants';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  AnswerDto,
  CurriculumActor,
  LearnerQuestionDto,
  QuestionDto,
  QuestionType,
  QuizDetailDto,
} from '../dto/curriculum.dto';
import { curriculumRepository } from '../repositories/curriculum.repository';

export interface AnswerInput {
  answerText: string;
  isCorrect: boolean;
  answerOrder: number;
}

export interface QuizServiceDeps {
  repo: typeof curriculumRepository;
  audit: typeof auditLogService;
}

function defaultDeps(): QuizServiceDeps {
  return { repo: curriculumRepository, audit: auditLogService };
}

/**
 * F4 §08: quiz, question and answer CRUD. Enforces the correct-answer
 * invariant (§05 rule 6) and strips `is_correct` from every learner-facing
 * response (AC-04). Quiz creation defaults `is_published` to the parent
 * module state so the published-before-parent rule (§05 rule 4) holds.
 */
export class QuizService {
  constructor(private readonly deps: QuizServiceDeps = defaultDeps()) {}

  /** §05 invariant 6: exactly-one / at-least-one correct answer per type. */
  assertAnswerInvariant(questionType: QuestionType, answers: AnswerInput[]): void {
    if (answers.length === 0) {
      throw new ValidationError('A question must have at least one answer.');
    }
    const correctCount = answers.filter((answer) => answer.isCorrect).length;
    if (questionType === 'multiple_choice' || questionType === 'true_false') {
      if (correctCount !== 1) {
        throw new ValidationError(
          'Multiple choice and true/false questions must have exactly one correct answer.',
        );
      }
    } else if (correctCount < 1) {
      throw new ValidationError('This question type requires at least one correct answer.');
    }
  }

  /** F4-API-19: create quiz under a module (DRAFT unless module is published). */
  async createQuiz(
    actor: CurriculumActor,
    moduleId: number,
    input: {
      title: string;
      description?: string;
      passingScore: number;
      timeLimitMinutes: number | null;
      isRequired: boolean;
    },
  ): Promise<QuizDetailDto> {
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }
    const quizId = await this.deps.repo.createQuiz({
      moduleId,
      title: input.title,
      description: input.description ?? null,
      passingScore: input.passingScore,
      timeLimitMinutes: input.timeLimitMinutes,
      isRequired: input.isRequired,
      isPublished: module.isPublished,
    });

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_QUIZ, 'quiz', quizId, {
      moduleId,
      title: input.title,
    });
    await this.deps.repo.refreshCourseCounts(module.courseId);

    return this.getQuizAdminDetail(quizId);
  }

  /** F4-API-20: update quiz metadata (including publish toggle). */
  async updateQuiz(
    actor: CurriculumActor,
    quizId: number,
    input: Partial<{
      title: string;
      description: string | null;
      passingScore: number;
      timeLimitMinutes: number | null;
      isRequired: boolean;
      isPublished: boolean;
    }>,
  ): Promise<QuizDetailDto> {
    const quiz = await this.deps.repo.findQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const module = await this.deps.repo.findModuleById(quiz.moduleId);
    if (!module) {
      throw new NotFoundError('Module not found.');
    }

    // §05 rule 4 (published-before-parent): a quiz cannot be published unless
    // its parent module is published.
    if (input.isPublished === true && !module.isPublished) {
      throw new ConflictError(
        'Publish the parent module before publishing its quiz.',
      );
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if ('description' in input) patch.description = input.description;
    if (input.passingScore !== undefined) patch.passingScore = input.passingScore;
    if ('timeLimitMinutes' in input) patch.timeLimitMinutes = input.timeLimitMinutes;
    if (input.isRequired !== undefined) patch.isRequired = input.isRequired;
    if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

    if (Object.keys(patch).length > 0) {
      await this.deps.repo.updateQuiz(quizId, patch);
      await this.deps.repo.refreshCourseCounts(module.courseId);
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_QUIZ, 'quiz', quizId, patch);
    return this.getQuizAdminDetail(quizId);
  }

  /** F4-API-21: create question with answers under a quiz. */
  async createQuestion(
    actor: CurriculumActor,
    quizId: number,
    input: {
      questionText: string;
      questionType: QuestionType;
      points: number;
      explanation: string | null;
      questionOrder: number;
      answers: AnswerInput[];
    },
  ): Promise<QuestionDto> {
    const quiz = await this.deps.repo.findQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    this.assertAnswerInvariant(input.questionType, input.answers);

    const questionId = await this.deps.repo.createQuestion({
      quizId,
      questionText: input.questionText,
      questionType: input.questionType,
      points: input.points,
      explanation: input.explanation,
      questionOrder: input.questionOrder,
    });
    await this.deps.repo.replaceAnswers(questionId, input.answers);

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.CREATE_QUESTION, 'quiz_question', questionId, {
      quizId,
      questionType: input.questionType,
    });

    return this.getQuestionAdminDetail(questionId);
  }

  /** F4-API-22: update question; answers are replaced wholesale when sent. */
  async updateQuestion(
    actor: CurriculumActor,
    questionId: number,
    input: Partial<{
      questionText: string;
      questionType: QuestionType;
      points: number;
      explanation: string | null;
      questionOrder: number;
      isActive: boolean;
      answers: AnswerInput[];
    }>,
  ): Promise<QuestionDto> {
    const existing = await this.deps.repo.findQuestionById(questionId);
    if (!existing) {
      throw new NotFoundError('Question not found.');
    }

    const nextType = input.questionType ?? existing.questionType;
    const nextAnswers = input.answers;
    if (nextAnswers) {
      this.assertAnswerInvariant(nextType, nextAnswers);
    }

    const patch: Record<string, unknown> = {};
    if (input.questionText !== undefined) patch.questionText = input.questionText;
    if (input.questionType !== undefined) patch.questionType = input.questionType;
    if (input.points !== undefined) patch.points = input.points;
    if ('explanation' in input) patch.explanation = input.explanation;
    if (input.questionOrder !== undefined) patch.questionOrder = input.questionOrder;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    if (Object.keys(patch).length > 0) {
      await this.deps.repo.updateQuestion(questionId, patch);
    }
    if (nextAnswers) {
      await this.deps.repo.replaceAnswers(questionId, nextAnswers);
    }

    crashAudit(this.deps.audit, actor, AUDIT_ACTIONS.UPDATE_QUESTION, 'quiz_question', questionId, patch);
    return this.getQuestionAdminDetail(questionId);
  }

  /** Admin module editor payload: all module quizzes with full questions. */
  async getQuizAdminDetailForModule(moduleId: number): Promise<QuizDetailDto[]> {
    const rows = await this.deps.repo.listQuizzesByModule(moduleId);
    const quizzes: QuizDetailDto[] = [];
    for (const row of rows) {
      quizzes.push(await this.getQuizAdminDetail(row.quizId));
    }
    return quizzes;
  }

  /** Admin quiz detail with questions and (correct) answers. */
  async getQuizAdminDetail(quizId: number): Promise<QuizDetailDto> {
    const quiz = await this.deps.repo.findQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const questionRows = await this.deps.repo.listQuestionsByQuiz(quizId, true);
    const questions: QuestionDto[] = [];
    for (const row of questionRows) {
      questions.push(await this.getQuestionAdminDetail(row.questionId));
    }
    return {
      quizId: quiz.quizId,
      moduleId: quiz.moduleId,
      title: quiz.title,
      description: quiz.description,
      passingScore: quiz.passingScore,
      timeLimitMinutes: quiz.timeLimitMinutes,
      isRequired: quiz.isRequired,
      isPublished: quiz.isPublished,
      questionCount: questions.length,
      questions,
    };
  }

  /** AC-04: learner-safe quiz questions with `is_correct` stripped. */
  async getQuizLearnerQuestions(quizId: number): Promise<LearnerQuestionDto[]> {
    const rows = await this.deps.repo.listQuestionsByQuiz(quizId, false);
    const questions: LearnerQuestionDto[] = [];
    for (const row of rows) {
      const detail = await this.getQuestionAdminDetail(row.questionId);
      questions.push(this.stripCorrectAnswers(detail));
    }
    return questions;
  }

  /** Returns a question DTO where answer `is_correct` flags are removed. */
  stripCorrectAnswers(question: QuestionDto): LearnerQuestionDto {
    return {
      ...question,
      answers: question.answers.map(({ isCorrect: _isCorrect, ...rest }: AnswerDto) => rest),
    };
  }

  private async getQuestionAdminDetail(questionId: number): Promise<QuestionDto> {
    const row = await this.deps.repo.findQuestionById(questionId);
    if (!row) {
      throw new NotFoundError('Question not found.');
    }
    const answers = await this.deps.repo.listAnswersByQuestion(questionId);
    return {
      questionId: row.questionId,
      quizId: row.quizId,
      questionText: row.questionText,
      questionType: row.questionType,
      points: row.points,
      explanation: row.explanation,
      questionOrder: row.questionOrder,
      isActive: row.isActive,
      answers: answers.map((answer) => ({
        answerId: answer.answerId,
        questionId: answer.questionId,
        answerText: answer.answerText,
        isCorrect: answer.isCorrect,
        answerOrder: answer.answerOrder,
      })),
    };
  }
}

function crashAudit(
  audit: typeof auditLogService,
  actor: CurriculumActor,
  action: string,
  targetType: string,
  targetId: number,
  changes: Record<string, unknown>,
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
    .catch(() => undefined);
}

export const quizService = new QuizService();
