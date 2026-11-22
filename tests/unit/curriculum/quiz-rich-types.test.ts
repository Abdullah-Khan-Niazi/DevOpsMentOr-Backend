import { describe, expect, it } from 'vitest';
import {
  checkQuestionShape,
  createQuestionSchema,
  updateQuestionSchema,
} from '../../../src/features/curriculum/validators/curriculum.validator';

type AnswerInput = { answerText: string; isCorrect: boolean; answerOrder: number };

const ans = (text: string, isCorrect: boolean, answerOrder: number): AnswerInput => ({
  answerText: text,
  isCorrect,
  answerOrder,
});

const terminalConfig = (terminal: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  terminal: { labId: 3, ...terminal },
  ...extra,
});

describe('per-type answer rules (checkQuestionShape)', () => {
  it('multiple_choice needs 2..10 answers with exactly one correct', () => {
    expect(checkQuestionShape('multiple_choice', {}, [ans('a', true, 1), ans('b', false, 2)]).issues).toEqual([]);
    expect(checkQuestionShape('multiple_choice', {}, [ans('a', true, 1)]).issues.map((i) => i.message))
      .toContain('Add between 2 and 10 answers.');
    expect(checkQuestionShape('multiple_choice', {}, [ans('a', true, 1), ans('b', true, 2)]).issues.map((i) => i.message))
      .toContain('Exactly one answer must be correct.');
    expect(checkQuestionShape('multiple_choice', {}, [ans('a', false, 1), ans('b', false, 2)]).issues.length).toBe(1);
  });

  it('true_false needs exactly 2 answers and one correct', () => {
    expect(checkQuestionShape('true_false', {}, [ans('True', true, 1), ans('False', false, 2)]).issues).toEqual([]);
    expect(checkQuestionShape('true_false', {}, [ans('True', true, 1), ans('False', false, 2), ans('Maybe', false, 3)]).issues[0].message)
      .toMatch(/exactly 2 answers/);
  });

  it('multiple_select needs at least one correct answer', () => {
    expect(checkQuestionShape('multiple_select', {}, [ans('a', true, 1), ans('b', true, 2)]).issues).toEqual([]);
    expect(checkQuestionShape('multiple_select', {}, [ans('a', false, 1), ans('b', false, 2)]).issues[0].message)
      .toBe('At least one answer must be correct.');
  });

  it('fill_blank requires every accepted answer to be correct', () => {
    expect(checkQuestionShape('fill_blank', {}, [ans('ls', true, 1)]).issues).toEqual([]);
    const issues = checkQuestionShape('fill_blank', {}, [ans('ls', true, 1), ans('dir', false, 2)]).issues;
    expect(issues).toEqual([
      { path: ['answers', 1, 'isCorrect'], message: 'Every accepted answer must be correct.' },
    ]);
  });

  it('ordering needs positions 1..n without gaps or duplicates', () => {
    expect(checkQuestionShape('ordering', {}, [ans('A', true, 1), ans('B', true, 2)]).issues).toEqual([]);
    expect(checkQuestionShape('ordering', {}, [ans('A', true, 1), ans('B', true, 1)]).issues[0].message)
      .toMatch(/without gaps/);
    expect(checkQuestionShape('ordering', {}, [ans('A', true, 1), ans('B', true, 3)]).issues[0].message)
      .toMatch(/without gaps/);
    expect(checkQuestionShape('ordering', {}, [ans('A', true, 1)]).issues.map((i) => i.message))
      .toContain('Add between 2 and 20 answers.');
  });

  it('bucket_sort needs at least two buckets and card buckets inside the range', () => {
    expect(checkQuestionShape('bucket_sort', { buckets: ['One'] }, [ans('A', false, 1)]).issues[0].path[0]).toBe('config');
    expect(checkQuestionShape('bucket_sort', { buckets: ['True', 'False'] }, [ans('A', false, 1), ans('B', false, 2)]).issues)
      .toEqual([]);
    const issues = checkQuestionShape('bucket_sort', { buckets: ['True', 'False'] }, [ans('A', false, 1), ans('B', false, 3)]).issues;
    expect(issues).toEqual([
      { path: ['answers', 1, 'answerOrder'], message: 'Bucket number must be between 1 and 2.' },
    ]);
  });

  it('terminal check questions take no answers and need a check', () => {
    const check = { type: 'command', command: 'test -f /tmp/x', expect: { mode: 'exitCode', value: 0 } };
    const ok = checkQuestionShape('terminal', terminalConfig({ mode: 'check', check }), []);
    expect(ok.issues).toEqual([]);
    const withAnswers = checkQuestionShape('terminal', terminalConfig({ mode: 'check', check }), [ans('x', true, 1)]);
    expect(withAnswers.issues.map((i) => i.message)).toContain('Check questions take no answers.');
    const noCheck = checkQuestionShape('terminal', terminalConfig({ mode: 'check' }), []);
    expect(noCheck.issues.map((i) => i.message)).toContain('Check questions need a check.');
  });

  it('terminal answer questions follow the choice or text answer rules', () => {
    const choice = terminalConfig({ mode: 'answer', answerFormat: 'choice' });
    expect(checkQuestionShape('terminal', choice, [ans('a', true, 1), ans('b', false, 2)]).issues).toEqual([]);
    expect(checkQuestionShape('terminal', choice, [ans('a', true, 1), ans('b', true, 2)]).issues[0].message)
      .toBe('Exactly one answer must be correct.');
    const text = terminalConfig({ mode: 'answer', answerFormat: 'text' });
    expect(checkQuestionShape('terminal', text, [ans('42', true, 1)]).issues).toEqual([]);
    expect(checkQuestionShape('terminal', text, [ans('42', false, 1)]).issues[0].path).toEqual(['answers', 0, 'isCorrect']);
    expect(checkQuestionShape('terminal', terminalConfig({ mode: 'answer' }), [ans('42', true, 1)]).issues.map((i) => i.message))
      .toContain('Choose an answer format (choice or text) for answer questions.');
  });
});

describe('penalty defaults and bounds', () => {
  it('defaults wrongPenalty to 2 and guessPenalty to 0 for plain types', () => {
    const { config } = checkQuestionShape('multiple_choice', {}, [ans('a', true, 1), ans('b', false, 2)]);
    expect(config).toMatchObject({ wrongPenalty: 2, guessPenalty: 0 });
  });

  it('defaults bucket_sort penalties the same way', () => {
    const { config } = checkQuestionShape('bucket_sort', { buckets: ['a', 'b'] }, [ans('A', false, 1)]);
    expect(config).toMatchObject({ wrongPenalty: 2, guessPenalty: 0 });
  });

  it('defaults the terminal guessPenalty to 5 in answer mode and 0 in check mode', () => {
    const answer = checkQuestionShape('terminal', terminalConfig({ mode: 'answer', answerFormat: 'text' }), [ans('x', true, 1)]);
    expect(answer.config).toMatchObject({ wrongPenalty: 2, guessPenalty: 5 });
    const check = checkQuestionShape(
      'terminal',
      terminalConfig({ mode: 'check', check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } } }),
      [],
    );
    expect(check.config).toMatchObject({ wrongPenalty: 2, guessPenalty: 0 });
  });

  it('keeps an explicit terminal guessPenalty of 0 in answer mode', () => {
    const { config } = checkQuestionShape(
      'terminal',
      terminalConfig({ mode: 'answer', answerFormat: 'text' }, { guessPenalty: 0 }),
      [ans('x', true, 1)],
    );
    expect(config.guessPenalty).toBe(0);
  });

  it('rejects penalties outside 0..1000 and non-integers', () => {
    const a = [ans('a', true, 1), ans('b', false, 2)];
    expect(checkQuestionShape('multiple_choice', { wrongPenalty: 1001 }, a).issues.length).toBeGreaterThan(0);
    expect(checkQuestionShape('multiple_choice', { guessPenalty: -1 }, a).issues.length).toBeGreaterThan(0);
    expect(checkQuestionShape('multiple_choice', { wrongPenalty: 1.5 }, a).issues.length).toBeGreaterThan(0);
    expect(checkQuestionShape('multiple_choice', { wrongPenalty: 1000, guessPenalty: 0 }, a).issues).toEqual([]);
  });

  it('rejects unknown config keys', () => {
    expect(checkQuestionShape('multiple_choice', { surprise: 1 }, [ans('a', true, 1), ans('b', false, 2)]).issues.length)
      .toBeGreaterThan(0);
  });
});

describe('question write schemas', () => {
  const base = {
    questionText: 'Which command lists files?',
    questionType: 'multiple_choice' as const,
    answers: [ans('ls', true, 1), ans('cd', false, 2)],
  };

  it('createQuestionSchema stores the config with its penalty values', () => {
    const parsed = createQuestionSchema.parse(base);
    expect(parsed.config).toMatchObject({ wrongPenalty: 2, guessPenalty: 0 });
    expect(parsed.points).toBe(10);
  });

  it('createQuestionSchema maps shape issues to paths', () => {
    const result = createQuestionSchema.safeParse({ ...base, answers: [ans('ls', true, 1), ans('cd', true, 2)] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['answers']);
    }
  });

  it('updateQuestionSchema requires questionType, config and answers together', () => {
    const result = updateQuestionSchema.safeParse({ questionType: 'multiple_choice' });
    expect(result.success).toBe(false);
    expect(updateQuestionSchema.safeParse({ points: 20 }).success).toBe(true);
    expect(updateQuestionSchema.safeParse({}).success).toBe(false);
  });

  it('updateQuestionSchema revalidates the whole triple', () => {
    const ok = updateQuestionSchema.safeParse({ questionType: 'multiple_choice', config: {}, answers: base.answers });
    expect(ok.success).toBe(true);
    const bad = updateQuestionSchema.safeParse({
      questionType: 'true_false',
      config: {},
      answers: [ans('a', true, 1), ans('b', false, 2), ans('c', false, 3)],
    });
    expect(bad.success).toBe(false);
  });
});
