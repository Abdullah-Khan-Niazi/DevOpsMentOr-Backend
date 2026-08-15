import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/shared/errors';
import { curriculumService } from '../../src/features/curriculum/services/CurriculumService';
import { activityLogService } from '../../src/features/progress/services/ActivityLogService';
import {
  QuizAttemptService,
  type QuizAttemptServiceDeps,
  type QuizAnswerInput,
} from '../../src/features/progress/services/QuizAttemptService';
import type { QuestionWithAnswersRow } from '../../src/features/progress/repositories/progress.repository';

function question(
  overrides: Partial<QuestionWithAnswersRow> = {},
): QuestionWithAnswersRow {
  return {
    questionId: 1,
    questionText: 'Which command builds an image?',
    questionType: 'multiple_choice',
    points: 10,
    explanation: null,
    questionOrder: 1,
    answers: [
      { answerId: 11, answerText: 'docker build', isCorrect: true, answerOrder: 1 },
      { answerId: 12, answerText: 'docker run', isCorrect: false, answerOrder: 2 },
      { answerId: 13, answerText: 'docker push', isCorrect: false, answerOrder: 3 },
    ],
    ...overrides,
  };
}

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeRepo(): Mocked<QuizAttemptServiceDeps['repo']> {
  return {
    listQuizQuestionsWithAnswers: vi.fn(async () => []),
    countQuizAttempts: vi.fn(async () => 0),
    insertAttemptWithAnswers: vi.fn(async () => 41),
    listQuizAttemptsByQuiz: vi.fn(async () => []),
  };
}

vi.mock('../../src/features/curriculum/services/CurriculumService', () => ({
  curriculumService: {
    getQuizById: vi.fn(async () => ({
      quizId: 30,
      moduleId: 10,
      passingScore: 70,
      timeLimitMinutes: null,
      isRequired: true,
    })),
    getModuleById: vi.fn(async () => ({
      moduleId: 10,
      courseId: 1,
      title: 'Docker Fundamentals',
      moduleOrder: 1,
    })),
    getCourseSnapshot: vi.fn(async () => ({
      courseId: 1,
      title: 'DevOps Mentor',
      totalModules: 2,
      totalLessons: 10,
      totalQuizzes: 2,
    })),
  },
}));

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
  },
}));

function makeService(repo = makeRepo()): {
  service: QuizAttemptService;
  repo: Mocked<QuizAttemptServiceDeps['repo']>;
} {
  return { service: new QuizAttemptService({ repo }), repo };
}

const submitted = (answers: QuizAnswerInput[], timeTakenSeconds = 300) => ({ answers, timeTakenSeconds });

describe('QuizAttemptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scoreAttempt (question type matrix)', () => {
    it('scores multiple_choice correctly', () => {
      const { service } = makeService();
      const result = service.scoreAttempt(
        [question()],
        [{ questionId: 1, answerId: 11 }],
      );
      expect(result.pointsEarned).toBe(10);
      expect(result.answers[0].isCorrect).toBe(true);
    });

    it('scores a wrong multiple_choice answer as zero', () => {
      const { service } = makeService();
      const result = service.scoreAttempt(
        [question()],
        [{ questionId: 1, answerId: 12 }],
      );
      expect(result.pointsEarned).toBe(0);
      expect(result.answers[0].isCorrect).toBe(false);
    });

    it('scores true_false like single selection', () => {
      const { service } = makeService();
      const tf = question({
        questionId: 2,
        questionType: 'true_false',
        answers: [
          { answerId: 21, answerText: 'True', isCorrect: true, answerOrder: 1 },
          { answerId: 22, answerText: 'False', isCorrect: false, answerOrder: 2 },
        ],
      });
      expect(service.scoreAttempt([tf], [{ questionId: 2, answerId: 21 }]).pointsEarned).toBe(10);
      expect(service.scoreAttempt([tf], [{ questionId: 2, answerId: 22 }]).pointsEarned).toBe(0);
    });

    it('scores fill_blank case-insensitively (AC-05)', () => {
      const { service } = makeService();
      const fb = question({
        questionId: 3,
        questionType: 'fill_blank',
        answers: [{ answerId: 31, answerText: 'docker build', isCorrect: true, answerOrder: 1 }],
      });
      expect(
        service.scoreAttempt([fb], [{ questionId: 3, answerText: 'Docker Build' }]).pointsEarned,
      ).toBe(10);
      expect(
        service.scoreAttempt([fb], [{ questionId: 3, answerText: 'docker run' }]).pointsEarned,
      ).toBe(0);
    });

    it('scores multiple_select only on an exact set match', () => {
      const { service } = makeService();
      const ms = question({
        questionId: 4,
        questionType: 'multiple_select',
        answers: [
          { answerId: 41, answerText: 'a', isCorrect: true, answerOrder: 1 },
          { answerId: 42, answerText: 'b', isCorrect: true, answerOrder: 2 },
          { answerId: 43, answerText: 'c', isCorrect: false, answerOrder: 3 },
        ],
      });
      const exact = service.scoreAttempt(
        [ms],
        [
          { questionId: 4, answerId: 41 },
          { questionId: 4, answerId: 42 },
        ],
      );
      expect(exact.pointsEarned).toBe(10);

      const partial = service.scoreAttempt([ms], [{ questionId: 4, answerId: 41 }]);
      expect(partial.pointsEarned).toBe(0);
    });

    it('aggregates points across mixed question types', () => {
      const { service } = makeService();
      const questions = [
        question({ questionId: 1, points: 10 }),
        question({ questionId: 2, questionType: 'fill_blank', points: 20, answers: [{ answerId: 21, answerText: 'kubectl', isCorrect: true, answerOrder: 1 }] }),
      ];
      const result = service.scoreAttempt(questions, [
        { questionId: 1, answerId: 11 },
        { questionId: 2, answerText: 'KUBECTL' },
      ]);
      expect(result.pointsEarned).toBe(30);
    });
  });

  describe('submitAttempt', () => {
    it('404s when the quiz does not exist', async () => {
      const { service } = makeService();
      vi.mocked(curriculumService.getQuizById).mockResolvedValueOnce(null);
      await expect(
        service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 11 }])),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects answers for questions outside the quiz', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      await expect(
        service.submitAttempt(9, 30, submitted([{ questionId: 999, answerId: 11 }])),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('409s when the client reports a time longer than the quiz limit', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      vi.mocked(curriculumService.getQuizById).mockResolvedValueOnce({
        quizId: 30,
        moduleId: 10,
        passingScore: 70,
        timeLimitMinutes: 10,
        isRequired: true,
      });
      await expect(
        service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 11 }], 7200)),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('stores the attempt, scores it, and returns the breakdown (AC-04)', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      const result = await service.submitAttempt(9, 30, submitted([
        { questionId: 1, answerId: 11 },
        { questionId: 1, answerId: 11 },
      ]));

      expect(repo.countQuizAttempts).toHaveBeenCalledWith(9, 30);
      expect(repo.insertAttemptWithAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 9, quizId: 30, score: 100, isPassed: true, attemptNumber: 1 }),
      );
      expect(result).toMatchObject({
        attemptId: 41,
        score: 100,
        isPassed: true,
        attemptNumber: 1,
        correctCount: 1,
        totalQuestions: 1,
      });
      expect(result.breakdown[0].isCorrect).toBe(true);
    });

    it('evaluates pass/fail against the passing score', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      const result = await service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 12 }]));
      expect(result.score).toBe(0);
      expect(result.isPassed).toBe(false);
      expect(result.correctCount).toBe(0);
    });

    it('rejects attempts for quizzes outside the canonical course (IDOR §05)', async () => {
      vi.mocked(curriculumService.getModuleById).mockResolvedValueOnce({
        moduleId: 99,
        courseId: 777,
        title: 'Foreign module',
        moduleOrder: 1,
      });
      const { service } = makeService();
      await expect(
        service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 11 }])),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('increments the attempt number per attempt', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      repo.countQuizAttempts.mockResolvedValueOnce(2);
      const { service } = makeService(repo);
      const result = await service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 11 }]));
      expect(result.attemptNumber).toBe(3);
    });

    it('logs QUIZ_PASSED for a passing attempt', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      await service.submitAttempt(9, 30, submitted([{ questionId: 1, answerId: 11 }]));
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(
        9,
        'QUIZ_PASSED',
        expect.objectContaining({ quizId: 30, score: 100 }),
      );
    });
  });

  describe('getQuizQuestions', () => {
    it('404s for an unknown quiz', async () => {
      vi.mocked(curriculumService.getQuizById).mockResolvedValueOnce(null);
      const { service } = makeService();
      await expect(service.getQuizQuestions(9, 30)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('strips is_correct and logs QUIZ_STARTED (AC-08)', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([question()]);
      const { service } = makeService(repo);
      const questions = await service.getQuizQuestions(9, 30);

      expect(questions[0].answers[0]).not.toHaveProperty('isCorrect');
      expect(questions[0].answers).toHaveLength(3);
      expect(activityLogService.recordEvent).toHaveBeenCalledWith(9, 'QUIZ_STARTED', {
        quizId: 30,
      });
    });

    it('does not log QUIZ_STARTED for a quiz with no questions', async () => {
      const repo = makeRepo();
      repo.listQuizQuestionsWithAnswers.mockResolvedValueOnce([]);
      const { service } = makeService(repo);
      const questions = await service.getQuizQuestions(9, 30);
      expect(questions).toEqual([]);
      expect(activityLogService.recordEvent).not.toHaveBeenCalled();
    });
  });
});
