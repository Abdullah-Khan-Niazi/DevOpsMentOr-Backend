import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/errors';
import { QuizService, type QuizServiceDeps } from '../../../src/features/curriculum/services/QuizService';

vi.mock('../../../src/app/database', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tag: 'tx' })) },
}));
vi.mock('../../../src/features/curriculum/services/curriculum-slug.service', () => ({
  curriculumSlugService: { recomputeCourse: vi.fn(async () => undefined) },
}));

type Fn = ReturnType<typeof vi.fn>;

const actor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

function quizRow(overrides: Record<string, unknown> = {}) {
  return {
    quizId: 30, moduleId: 10, title: 'Docker Quiz', description: null, passingScore: 70,
    timeLimitMinutes: null, isRequired: true, isPublished: false,
    createdAt: new Date('2026-01-04T00:00:00.000Z'), updatedAt: new Date('2026-01-04T00:00:00.000Z'),
    ...overrides,
  };
}

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    questionId: 41, quizId: 30, questionText: 'Which one?', questionType: 'multiple_choice',
    config: { wrongPenalty: 2, guessPenalty: 0 }, points: 10, explanation: null, questionOrder: 1, isActive: true,
    ...overrides,
  };
}

function makeRepo() {
  return {
    findQuizById: vi.fn(async () => quizRow()),
    updateQuiz: vi.fn(async () => undefined),
    deleteQuiz: vi.fn(async () => undefined),
    hasQuizLearnerData: vi.fn(async () => false),
    findModuleById: vi.fn(async () => ({ moduleId: 10, courseId: 1 })),
    findCourseById: vi.fn(async () => ({ courseId: 1, isPremium: false })),
    listLessonsByModule: vi.fn(async () => [{ lessonId: 20, quizId: 30, lessonOrder: 1 }]),
    bulkUpdateLessonOrders: vi.fn(async () => undefined),
    updateLesson: vi.fn(async () => undefined),
    refreshCourseCounts: vi.fn(async () => undefined),
    listQuestionsByQuiz: vi.fn(async () => [questionRow()]),
    findQuestionById: vi.fn(async () => questionRow()),
    createQuestion: vi.fn(async () => 41),
    updateQuestion: vi.fn(async () => undefined),
    deleteQuestion: vi.fn(async () => undefined),
    bulkUpdateQuestionOrders: vi.fn(async () => undefined),
    hasQuestionLearnerData: vi.fn(async () => false),
    replaceAnswers: vi.fn(async () => undefined),
    listAnswersByQuestion: vi.fn(async () => []),
  };
}

function makeService(repoOverrides: Record<string, Fn> = {}, lab: unknown = { labId: 3, labName: 'Linux Lab', isPremium: false }) {
  const repo = { ...makeRepo(), ...repoOverrides };
  const audit = { record: vi.fn(async () => undefined) };
  const labs = { findLabById: vi.fn(async () => lab) };
  const service = new QuizService({ repo, audit, labs } as unknown as QuizServiceDeps);
  return { service, repo, audit, labs };
}

const a = (answerText: string, isCorrect: boolean, answerOrder: number) => ({ answerText, isCorrect, answerOrder });
const mcAnswers = [a('x', true, 1), a('y', false, 2)];

describe('QuizService question authoring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a multiple choice question appended at the end with the stored config', async () => {
    const { service, repo, audit } = makeService();
    const result = await service.createQuestion(actor, 30, {
      questionText: 'Which one?', questionType: 'multiple_choice', config: { wrongPenalty: 2, guessPenalty: 0 },
      points: 10, explanation: null, answers: mcAnswers,
    });
    expect(repo.createQuestion).toHaveBeenCalledWith(expect.objectContaining({ quizId: 30, questionOrder: 2 }), expect.anything());
    expect(repo.replaceAnswers).toHaveBeenCalledWith(41, mcAnswers, expect.anything());
    expect(result.warnings).toEqual([]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_question', targetId: 41 }));
  });

  it('404s when the quiz does not exist', async () => {
    const { service } = makeService({ findQuizById: vi.fn(async () => null) });
    await expect(service.createQuestion(actor, 99, {
      questionText: 'q', questionType: 'multiple_choice', points: 10, explanation: null, answers: mcAnswers,
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([
    ['multiple_choice with two correct', 'multiple_choice', [a('x', true, 1), a('y', true, 2)]],
    ['true_false with three answers', 'true_false', [a('T', true, 1), a('F', false, 2), a('M', false, 3)]],
    ['multiple_select without a correct answer', 'multiple_select', [a('x', false, 1), a('y', false, 2)]],
    ['fill_blank with an incorrect accepted answer', 'fill_blank', [a('x', true, 1), a('y', false, 2)]],
    ['ordering with a gap', 'ordering', [a('x', true, 1), a('y', true, 3)]],
  ])('rejects %s with INVALID_ANSWER_SHAPE and writes nothing', async (_label, questionType, answers) => {
    const { service, repo } = makeService();
    await expect(service.createQuestion(actor, 30, {
      questionText: 'q', questionType: questionType as never, config: {}, points: 10, explanation: null, answers,
    })).rejects.toBeInstanceOf(ValidationError);
    expect(repo.createQuestion).not.toHaveBeenCalled();
  });

  it('accepts a terminal check question with no answers', async () => {
    const { service, repo } = makeService();
    const config = {
      wrongPenalty: 2, guessPenalty: 0,
      terminal: { labId: 3, mode: 'check', answerFormat: null, setup: [], check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } } },
    };
    await service.createQuestion(actor, 30, { questionText: 'q', questionType: 'terminal', config, points: 10, explanation: null, answers: [] });
    expect(repo.createQuestion).toHaveBeenCalled();
    expect(repo.replaceAnswers).toHaveBeenCalledWith(41, [], expect.anything());
  });

  it('rejects a terminal check question that carries answers', async () => {
    const { service } = makeService();
    const config = {
      terminal: { labId: 3, mode: 'check', answerFormat: null, setup: [], check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } } },
    };
    await expect(service.createQuestion(actor, 30, {
      questionText: 'q', questionType: 'terminal', config, points: 10, explanation: null, answers: [a('x', true, 1)],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('404s LAB_NOT_FOUND when the terminal lab does not exist', async () => {
    const { service, repo } = makeService({}, null);
    const config = { terminal: { labId: 77, mode: 'answer', answerFormat: 'text', setup: [] } };
    await expect(service.createQuestion(actor, 30, {
      questionText: 'q', questionType: 'terminal', config, points: 10, explanation: null, answers: [a('42', true, 1)],
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.createQuestion).not.toHaveBeenCalled();
  });

  it('warns when a premium lab sits in a free course', async () => {
    const { service } = makeService({}, { labId: 3, labName: 'Linux Lab', isPremium: true });
    const config = { terminal: { labId: 3, mode: 'answer', answerFormat: 'text', setup: [] } };
    const result = await service.createQuestion(actor, 30, {
      questionText: 'q', questionType: 'terminal', config, points: 10, explanation: null, answers: [a('42', true, 1)],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('premium lab');
  });

  it('refuses a type change on a question that has learner answers', async () => {
    const { service, repo } = makeService({ hasQuestionLearnerData: vi.fn(async () => true) });
    await expect(service.updateQuestion(actor, 41, {
      questionType: 'multiple_select', config: {}, answers: mcAnswers,
    })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.updateQuestion).not.toHaveBeenCalled();
  });

  it('allows editing text and answers without a type change when learner answers exist', async () => {
    const { service, repo } = makeService({ hasQuestionLearnerData: vi.fn(async () => true) });
    await service.updateQuestion(actor, 41, {
      questionText: 'New text', questionType: 'multiple_choice', config: {}, answers: mcAnswers,
    });
    expect(repo.updateQuestion).toHaveBeenCalledWith(41, expect.objectContaining({ questionText: 'New text' }), expect.anything());
    expect(repo.replaceAnswers).toHaveBeenCalled();
  });

  it('requires type, config and answers together on update', async () => {
    const { service } = makeService();
    await expect(service.updateQuestion(actor, 41, { questionType: 'true_false' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to delete a question with learner answers and compacts orders otherwise', async () => {
    const blocked = makeService({ hasQuestionLearnerData: vi.fn(async () => true) });
    await expect(blocked.service.deleteQuestion(actor, 41)).rejects.toBeInstanceOf(ConflictError);
    expect(blocked.repo.deleteQuestion).not.toHaveBeenCalled();

    const ok = makeService({ listQuestionsByQuiz: vi.fn(async () => [questionRow({ questionId: 42, questionOrder: 2 })]) });
    await ok.service.deleteQuestion(actor, 41);
    expect(ok.repo.deleteQuestion).toHaveBeenCalledWith(41, expect.anything());
    expect(ok.repo.bulkUpdateQuestionOrders).toHaveBeenCalledWith(30, [{ questionId: 42, questionOrder: 1 }], expect.anything());
  });

  it('reorders questions only with the exact full set', async () => {
    const rows = [questionRow({ questionId: 1, questionOrder: 1 }), questionRow({ questionId: 2, questionOrder: 2 })];
    const { service, repo } = makeService({ listQuestionsByQuiz: vi.fn(async () => rows) });
    await service.reorderQuestions(actor, 30, [2, 1]);
    expect(repo.bulkUpdateQuestionOrders).toHaveBeenCalledWith(
      30,
      [{ questionId: 2, questionOrder: 1 }, { questionId: 1, questionOrder: 2 }],
      expect.anything(),
    );
    for (const bad of [[1], [1, 1], [1, 2, 3], [1, 9]]) {
      await expect(service.reorderQuestions(actor, 30, bad)).rejects.toMatchObject({ statusCode: 422 });
    }
  });
});

describe('QuizService quiz administration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mirrors a title change onto the spine item in the same transaction', async () => {
    const { service, repo } = makeService();
    await service.updateQuiz(actor, 30, { title: 'Renamed quiz' });
    expect(repo.updateQuiz).toHaveBeenCalledWith(30, { title: 'Renamed quiz' }, expect.anything());
    expect(repo.updateLesson).toHaveBeenCalledWith(20, { title: 'Renamed quiz' }, expect.anything());
  });

  it('does not touch the spine when the title is unchanged', async () => {
    const { service, repo } = makeService();
    await service.updateQuiz(actor, 30, { passingScore: 80 });
    expect(repo.updateLesson).not.toHaveBeenCalled();
  });

  it('refuses to delete a quiz with attempts', async () => {
    const { service, repo } = makeService({ hasQuizLearnerData: vi.fn(async () => true) });
    await expect(service.deleteQuiz(actor, 30)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.deleteQuiz).not.toHaveBeenCalled();
  });

  it('deletes a quiz, compacts item orders and refreshes the course counts', async () => {
    const { service, repo } = makeService();
    await service.deleteQuiz(actor, 30);
    expect(repo.deleteQuiz).toHaveBeenCalledWith(30, expect.anything());
    expect(repo.refreshCourseCounts).toHaveBeenCalledWith(1, expect.anything());
  });
});
