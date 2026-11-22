import { describe, expect, it } from 'vitest';
import { ValidationError, ERROR_CODES } from '../../../src/shared/errors';
import {
  assertResponseShape,
  collapseWsLower,
  expectedResponseType,
  gradeResponse,
  type GradableAnswer,
  type GradableQuestion,
} from '../../../src/features/progress/services/quiz-grading';
import type { QuizAnswerResponse } from '../../../src/features/progress/dto/progress.dto';

function answer(answerId: number, overrides: Partial<GradableAnswer> = {}): GradableAnswer {
  return { answerId, answerText: `answer ${answerId}`, isCorrect: false, answerOrder: null, ...overrides };
}

function question(overrides: Partial<GradableQuestion> & Pick<GradableQuestion, 'questionType'>): GradableQuestion {
  return { questionId: 1, answers: [], config: {}, ...overrides };
}

function expectShapeError(fn: () => unknown) {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ValidationError);
  const error = thrown as ValidationError;
  expect(error.message).toBe('That answer does not fit this question.');
  expect(error.errors[0]).toEqual({ code: ERROR_CODES.INVALID_ANSWER_SHAPE });
}

const mcQuestion = question({
  questionType: 'multiple_choice',
  answers: [answer(1, { isCorrect: true }), answer(2), answer(3)],
});

const tfQuestion = question({
  questionType: 'true_false',
  answers: [answer(10, { isCorrect: true }), answer(11)],
});

const selectQuestion = question({
  questionType: 'multiple_select',
  answers: [answer(1, { isCorrect: true }), answer(2, { isCorrect: true }), answer(3), answer(4)],
});

const fillQuestion = question({
  questionType: 'fill_blank',
  answers: [answer(1, { answerText: 'Docker  Compose', isCorrect: true }), answer(2, { answerText: 'compose', isCorrect: true })],
});

const orderingQuestion = question({
  questionType: 'ordering',
  answers: [answer(1, { answerOrder: 2 }), answer(2, { answerOrder: 1 }), answer(3, { answerOrder: 3 })],
});

const bucketQuestion = question({
  questionType: 'bucket_sort',
  config: { buckets: ['Build', 'Run'] },
  answers: [answer(1, { answerOrder: 1 }), answer(2, { answerOrder: 2 }), answer(3, { answerOrder: 2 })],
});

const terminalCheck = question({
  questionType: 'terminal',
  config: { terminal: { labId: 5, mode: 'check', answerFormat: null, setup: [] } },
});

const terminalChoice = question({
  questionType: 'terminal',
  config: { terminal: { labId: 5, mode: 'answer', answerFormat: 'choice', setup: [] } },
  answers: [answer(1, { isCorrect: true }), answer(2)],
});

const terminalText = question({
  questionType: 'terminal',
  config: { terminal: { labId: 5, mode: 'answer', answerFormat: 'text', setup: [] } },
  answers: [answer(1, { answerText: 'ls -la', isCorrect: true })],
});

describe('collapseWsLower', () => {
  it('trims, collapses whitespace runs and lower-cases', () => {
    expect(collapseWsLower('  Docker \t  Compose\n ')).toBe('docker compose');
    expect(collapseWsLower('ABC')).toBe('abc');
  });
});

describe('expectedResponseType', () => {
  it('maps every non-terminal question type', () => {
    expect(expectedResponseType(mcQuestion)).toBe('choice');
    expect(expectedResponseType(tfQuestion)).toBe('choice');
    expect(expectedResponseType(selectQuestion)).toBe('multi');
    expect(expectedResponseType(fillQuestion)).toBe('text');
    expect(expectedResponseType(orderingQuestion)).toBe('ordering');
    expect(expectedResponseType(bucketQuestion)).toBe('buckets');
  });

  it('derives the terminal response type from config.terminal', () => {
    expect(expectedResponseType(terminalCheck)).toBe('terminal_check');
    expect(expectedResponseType(terminalChoice)).toBe('choice');
    expect(expectedResponseType(terminalText)).toBe('text');
  });

  it('throws on a terminal config without a valid mode', () => {
    const broken = question({ questionType: 'terminal', config: { terminal: { mode: 'nope' } } });
    expect(() => expectedResponseType(broken)).toThrow();
  });

  it('throws on a terminal answer config without a valid answerFormat', () => {
    const broken = question({ questionType: 'terminal', config: { terminal: { mode: 'answer', answerFormat: null } } });
    expect(() => expectedResponseType(broken)).toThrow();
  });
});

describe('assertResponseShape', () => {
  it('accepts well-formed responses', () => {
    expect(() => assertResponseShape(mcQuestion, { type: 'choice', answerId: 2 })).not.toThrow();
    expect(() => assertResponseShape(selectQuestion, { type: 'multi', answerIds: [1, 3] })).not.toThrow();
    expect(() => assertResponseShape(fillQuestion, { type: 'text', text: 'anything' })).not.toThrow();
    expect(() => assertResponseShape(orderingQuestion, { type: 'ordering', answerIds: [2, 1, 3] })).not.toThrow();
    expect(() =>
      assertResponseShape(bucketQuestion, {
        type: 'buckets',
        placements: [
          { answerId: 1, bucket: 1 },
          { answerId: 2, bucket: 2 },
          { answerId: 3, bucket: 2 },
        ],
      }),
    ).not.toThrow();
    expect(() => assertResponseShape(terminalCheck, { type: 'terminal_check' })).not.toThrow();
  });

  it('rejects a response type that does not match the question', () => {
    expectShapeError(() => assertResponseShape(mcQuestion, { type: 'multi', answerIds: [1] }));
    expectShapeError(() => assertResponseShape(fillQuestion, { type: 'choice', answerId: 1 }));
    expectShapeError(() => assertResponseShape(terminalCheck, { type: 'choice', answerId: 1 }));
    expectShapeError(() => assertResponseShape(terminalChoice, { type: 'terminal_check' }));
  });

  it('rejects a choice answerId that is not an option of the question', () => {
    expectShapeError(() => assertResponseShape(mcQuestion, { type: 'choice', answerId: 999 }));
  });

  it('rejects multi responses with unknown or repeated answerIds', () => {
    expectShapeError(() => assertResponseShape(selectQuestion, { type: 'multi', answerIds: [1, 999] }));
    expectShapeError(() => assertResponseShape(selectQuestion, { type: 'multi', answerIds: [1, 1] }));
  });

  it('rejects an ordering that does not list every option exactly once', () => {
    expectShapeError(() => assertResponseShape(orderingQuestion, { type: 'ordering', answerIds: [1, 2] }));
    expectShapeError(() => assertResponseShape(orderingQuestion, { type: 'ordering', answerIds: [1, 2, 2] }));
    expectShapeError(() => assertResponseShape(orderingQuestion, { type: 'ordering', answerIds: [1, 2, 999] }));
  });

  it('rejects buckets that do not place every card exactly once', () => {
    expectShapeError(() =>
      assertResponseShape(bucketQuestion, {
        type: 'buckets',
        placements: [
          { answerId: 1, bucket: 1 },
          { answerId: 2, bucket: 2 },
        ],
      }),
    );
    expectShapeError(() =>
      assertResponseShape(bucketQuestion, {
        type: 'buckets',
        placements: [
          { answerId: 1, bucket: 1 },
          { answerId: 1, bucket: 2 },
          { answerId: 2, bucket: 2 },
        ],
      }),
    );
    expectShapeError(() =>
      assertResponseShape(bucketQuestion, {
        type: 'buckets',
        placements: [
          { answerId: 1, bucket: 1 },
          { answerId: 2, bucket: 2 },
          { answerId: 999, bucket: 2 },
        ],
      }),
    );
  });

  it('rejects a bucket number above config.buckets.length', () => {
    expectShapeError(() =>
      assertResponseShape(bucketQuestion, {
        type: 'buckets',
        placements: [
          { answerId: 1, bucket: 1 },
          { answerId: 2, bucket: 3 },
          { answerId: 3, bucket: 2 },
        ],
      }),
    );
  });
});

describe('gradeResponse', () => {
  it('grades multiple choice and true/false by the chosen option', () => {
    expect(gradeResponse(mcQuestion, { type: 'choice', answerId: 1 })).toBe(true);
    expect(gradeResponse(mcQuestion, { type: 'choice', answerId: 2 })).toBe(false);
    expect(gradeResponse(tfQuestion, { type: 'choice', answerId: 10 })).toBe(true);
    expect(gradeResponse(tfQuestion, { type: 'choice', answerId: 11 })).toBe(false);
  });

  it('grades multiple select by set equality with the correct set', () => {
    expect(gradeResponse(selectQuestion, { type: 'multi', answerIds: [1, 2] })).toBe(true);
    expect(gradeResponse(selectQuestion, { type: 'multi', answerIds: [2, 1] })).toBe(true);
    expect(gradeResponse(selectQuestion, { type: 'multi', answerIds: [1] })).toBe(false);
    expect(gradeResponse(selectQuestion, { type: 'multi', answerIds: [1, 2, 3] })).toBe(false);
    expect(gradeResponse(selectQuestion, { type: 'multi', answerIds: [3, 4] })).toBe(false);
  });

  it('grades fill blank with whitespace and case normalisation against any accepted text', () => {
    expect(gradeResponse(fillQuestion, { type: 'text', text: '  docker   COMPOSE ' })).toBe(true);
    expect(gradeResponse(fillQuestion, { type: 'text', text: 'Compose' })).toBe(true);
    expect(gradeResponse(fillQuestion, { type: 'text', text: 'docker' })).toBe(false);
  });

  it('does not accept text that matches only a wrong answer', () => {
    const withWrong = question({
      questionType: 'fill_blank',
      answers: [answer(1, { answerText: 'yes', isCorrect: true }), answer(2, { answerText: 'no', isCorrect: false })],
    });
    expect(gradeResponse(withWrong, { type: 'text', text: 'no' })).toBe(false);
  });

  it('grades ordering when the ids equal the correct order by answerOrder', () => {
    expect(gradeResponse(orderingQuestion, { type: 'ordering', answerIds: [2, 1, 3] })).toBe(true);
    expect(gradeResponse(orderingQuestion, { type: 'ordering', answerIds: [1, 2, 3] })).toBe(false);
    expect(gradeResponse(orderingQuestion, { type: 'ordering', answerIds: [3, 2, 1] })).toBe(false);
  });

  it('throws when an ordering answer has no answerOrder', () => {
    const broken = question({
      questionType: 'ordering',
      answers: [answer(1, { answerOrder: 1 }), answer(2, { answerOrder: null })],
    });
    expect(() => gradeResponse(broken, { type: 'ordering', answerIds: [1, 2] })).toThrow();
  });

  it('grades buckets when each card sits in the bucket equal to its answerOrder', () => {
    const correct: QuizAnswerResponse = {
      type: 'buckets',
      placements: [
        { answerId: 1, bucket: 1 },
        { answerId: 2, bucket: 2 },
        { answerId: 3, bucket: 2 },
      ],
    };
    expect(gradeResponse(bucketQuestion, correct)).toBe(true);

    const oneWrong: QuizAnswerResponse = {
      type: 'buckets',
      placements: [
        { answerId: 1, bucket: 2 },
        { answerId: 2, bucket: 2 },
        { answerId: 3, bucket: 2 },
      ],
    };
    expect(gradeResponse(bucketQuestion, oneWrong)).toBe(false);
  });

  it('grades terminal choice and terminal text like their non-terminal counterparts', () => {
    expect(gradeResponse(terminalChoice, { type: 'choice', answerId: 1 })).toBe(true);
    expect(gradeResponse(terminalChoice, { type: 'choice', answerId: 2 })).toBe(false);
    expect(gradeResponse(terminalText, { type: 'text', text: 'LS   -LA' })).toBe(true);
    expect(gradeResponse(terminalText, { type: 'text', text: 'ls' })).toBe(false);
  });

  it('throws for terminal_check, which the attempt service grades', () => {
    expect(() => gradeResponse(terminalCheck, { type: 'terminal_check' })).toThrow();
  });

  it('throws the shape error before grading a mismatched response', () => {
    expectShapeError(() => gradeResponse(mcQuestion, { type: 'choice', answerId: 999 }));
    expectShapeError(() => gradeResponse(orderingQuestion, { type: 'ordering', answerIds: [1, 2] }));
  });
});
