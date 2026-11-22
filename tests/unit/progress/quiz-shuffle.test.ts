import { describe, expect, it } from 'vitest';
import { orderOptions, orderQuestions } from '../../../src/features/progress/services/quiz-shuffle';

const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const ids = [11, 12, 13, 14, 15, 16, 17, 18];

describe('orderQuestions', () => {
  it('is deterministic for the same attempt and questions', () => {
    expect(orderQuestions(7, ids, key)).toEqual(orderQuestions(7, ids, key));
  });

  it('returns a permutation of the input ids', () => {
    const ordered = orderQuestions(7, ids, key);
    expect(ordered).toHaveLength(ids.length);
    expect([...ordered].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });

  it('usually differs between attempts', () => {
    expect(orderQuestions(7, ids, key)).not.toEqual(orderQuestions(8, ids, key));
  });

  it('does not mutate the input array', () => {
    const input = [...ids];
    orderQuestions(3, input, key);
    expect(input).toEqual(ids);
  });
});

describe('orderOptions', () => {
  it('is deterministic for the same inputs', () => {
    expect(orderOptions(7, 2, ids, 'multiple_choice', key)).toEqual(orderOptions(7, 2, ids, 'multiple_choice', key));
  });

  it('returns a permutation of the input ids', () => {
    const ordered = orderOptions(7, 2, ids, 'multiple_select', key);
    expect(ordered).toHaveLength(ids.length);
    expect([...ordered].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });

  it('usually differs between attempts', () => {
    expect(orderOptions(7, 2, ids, 'multiple_choice', key)).not.toEqual(orderOptions(8, 2, ids, 'multiple_choice', key));
  });

  it('keeps the stored order for true_false', () => {
    const tf = [40, 41];
    expect(orderOptions(7, 2, tf, 'true_false', key)).toEqual([40, 41]);
    expect(orderOptions(99, 2, tf, 'true_false', key)).toEqual([40, 41]);
  });

  it('shuffles the options of non-true_false types', () => {
    const shuffled = [1, 2, 3, 4, 5, 6, 7, 8].map((attemptId) => orderOptions(attemptId, 2, ids, 'multiple_choice', key));
    const distinct = new Set(shuffled.map((order) => order.join(',')));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
