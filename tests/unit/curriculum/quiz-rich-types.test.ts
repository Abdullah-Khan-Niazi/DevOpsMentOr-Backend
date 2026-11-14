import { describe, expect, it } from 'vitest';
import { QuizAttemptService } from '../../../src/features/progress/services/QuizAttemptService';
import type { QuestionWithAnswersRow } from '../../../src/features/progress/repositories/progress.repository';
import { QuizService } from '../../../src/features/curriculum/services/QuizService';
import type { QuizServiceDeps } from '../../../src/features/curriculum/services/QuizService';
import type { QuestionDto } from '../../../src/features/curriculum/dto/curriculum.dto';

type AnswerInput = { answerText: string; isCorrect: boolean; answerOrder: number };

const attemptService = new QuizAttemptService({
  repo: {} as never,
});
const quizService = new QuizService({} as QuizServiceDeps);

function orderingQuestion(): QuestionWithAnswersRow {
  return {
    questionId: 1,
    questionText: 'Put the Git workflow steps in order.',
    questionType: 'ordering',
    config: null,
    points: 10,
    explanation: null,
    questionOrder: 1,
    answers: [
      { answerId: 101, answerText: 'Create a branch', isCorrect: true, answerOrder: 1 },
      { answerId: 102, answerText: 'Edit files', isCorrect: true, answerOrder: 2 },
      { answerId: 103, answerText: 'Commit', isCorrect: true, answerOrder: 3 },
    ],
  };
}

function bucketQuestion(): QuestionWithAnswersRow {
  return {
    questionId: 2,
    questionText: 'Classify each statement as True or False.',
    questionType: 'bucket_sort',
    config: { buckets: ['True', 'False'] },
    points: 10,
    explanation: null,
    questionOrder: 2,
    answers: [
      { answerId: 201, answerText: 'git status shows untracked files', isCorrect: false, answerOrder: 1 },
      { answerId: 202, answerText: 'git commit uploads to GitHub', isCorrect: false, answerOrder: 2 },
    ],
  };
}

describe('ordering questions', () => {
  it('accepts the exact correct sequence', () => {
    const result = attemptService.scoreAttempt([orderingQuestion()], [
      { questionId: 1, answerId: 101 },
      { questionId: 1, answerId: 102 },
      { questionId: 1, answerId: 103 },
    ]);
    expect(result.pointsEarned).toBe(10);
    expect(result.answers[0].isCorrect).toBe(true);
  });

  it('rejects a wrong sequence', () => {
    const result = attemptService.scoreAttempt([orderingQuestion()], [
      { questionId: 1, answerId: 102 },
      { questionId: 1, answerId: 101 },
      { questionId: 1, answerId: 103 },
    ]);
    expect(result.pointsEarned).toBe(0);
    expect(result.answers[0].isCorrect).toBe(false);
  });

  it('rejects incomplete sequences instead of crediting partial order', () => {
    const result = attemptService.scoreAttempt([orderingQuestion()], [
      { questionId: 1, answerId: 101 },
      { questionId: 1, answerId: 102 },
    ]);
    expect(result.answers[0].isCorrect).toBe(false);
  });

  it('validates unique positions when authoring', () => {
    const duplicates: AnswerInput[] = [
      { answerText: 'A', isCorrect: true, answerOrder: 1 },
      { answerText: 'B', isCorrect: true, answerOrder: 1 },
    ];
    expect(() => quizService.assertAnswerInvariant('ordering', duplicates, null)).toThrow(
      /unique position/i,
    );
  });

  it('requires at least two items', () => {
    expect(() =>
      quizService.assertAnswerInvariant(
        'ordering',
        [{ answerText: 'Only', isCorrect: true, answerOrder: 1 }],
        null,
      ),
    ).toThrow(/at least two/i);
  });
});

describe('bucket_sort questions', () => {
  it('accepts every card in its correct bucket', () => {
    const result = attemptService.scoreAttempt([bucketQuestion()], [
      { questionId: 2, answerId: 201, answerText: 'True' },
      { questionId: 2, answerId: 202, answerText: 'False' },
    ]);
    expect(result.pointsEarned).toBe(10);
  });

  it('rejects a card in the wrong bucket', () => {
    const result = attemptService.scoreAttempt([bucketQuestion()], [
      { questionId: 2, answerId: 201, answerText: 'False' },
      { questionId: 2, answerId: 202, answerText: 'False' },
    ]);
    expect(result.pointsEarned).toBe(0);
  });

  it('rejects incomplete card submissions', () => {
    const result = attemptService.scoreAttempt([bucketQuestion()], [
      { questionId: 2, answerId: 201, answerText: 'True' },
    ]);
    expect(result.answers[0].isCorrect).toBe(false);
  });

  it('requires at least two buckets when authoring', () => {
    const answers: AnswerInput[] = [
      { answerText: 'A', isCorrect: false, answerOrder: 1 },
      { answerText: 'B', isCorrect: false, answerOrder: 1 },
    ];
    expect(() =>
      quizService.assertAnswerInvariant('bucket_sort', answers, { buckets: ['Only'] }),
    ).toThrow(/at least two buckets/i);
  });

  it('rejects a card pointing at a missing bucket', () => {
    const answers: AnswerInput[] = [
      { answerText: 'A', isCorrect: false, answerOrder: 1 },
      { answerText: 'B', isCorrect: false, answerOrder: 3 },
    ];
    expect(() =>
      quizService.assertAnswerInvariant('bucket_sort', answers, { buckets: ['True', 'False'] }),
    ).toThrow(/between 1 and 2/i);
  });

  it('never leaks the correct bucket/order through the learner payload', () => {
    const adminQuestion: QuestionDto = {
      questionId: 2,
      quizId: 1,
      questionText: 'Classify',
      questionType: 'bucket_sort',
      config: { buckets: ['True', 'False'] },
      points: 10,
      explanation: null,
      questionOrder: 1,
      isActive: true,
      answers: [
        { answerId: 201, questionId: 2, answerText: 'Card A', isCorrect: true, answerOrder: 1 },
        { answerId: 202, questionId: 2, answerText: 'Card B', isCorrect: false, answerOrder: 2 },
      ],
    };
    const learner = quizService.stripCorrectAnswers(adminQuestion);
    expect(
      learner.answers.every((answer) => !('isCorrect' in answer)),
    ).toBe(true);
    expect(new Set(learner.answers.map((answer) => answer.answerId))).toEqual(
      new Set([201, 202]),
    );
  });
});
