import { createHmac } from 'crypto';
import { env } from '../../../app/config/env';
import type { QuizQuestionType } from '../dto/progress.dto';

/**
 * Deterministic, storage-free shuffle for quiz attempts. The order of questions and options
 * is a keyed hash of (attemptId, id), so a resumed attempt renders the same order and nothing
 * needs to be stored. The key is a sub-key derived from JWT_ACCESS_SECRET (not the raw secret).
 */

const SHUFFLE_KEY_LABEL = 'devopsmentor:quiz-shuffle:v1';

let cachedKey: Buffer | null = null;

/** HMAC_SHA256(env.JWT_ACCESS_SECRET, 'devopsmentor:quiz-shuffle:v1'), computed once per process. */
export function getQuizShuffleKey(): Buffer {
  if (cachedKey === null) {
    cachedKey = createHmac('sha256', env.JWT_ACCESS_SECRET).update(SHUFFLE_KEY_LABEL).digest();
  }
  return cachedKey;
}

function sortByRank(ids: number[], message: (id: number) => string, key: Buffer): number[] {
  const ranked = ids.map((id) => ({
    id,
    rank: createHmac('sha256', key).update(message(id)).digest('hex'),
  }));
  ranked.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id - b.id));
  return ranked.map((entry) => entry.id);
}

/** Question order for an attempt: ascending by HMAC(key, `quiz-shuffle:${attemptId}:${questionId}`). */
export function orderQuestions(attemptId: number, questionIds: number[], key: Buffer = getQuizShuffleKey()): number[] {
  return sortByRank(questionIds, (questionId) => `quiz-shuffle:${attemptId}:${questionId}`, key);
}

/**
 * Option order within a question: ascending by
 * HMAC(key, `quiz-shuffle:${attemptId}:${questionId}:${answerId}`) (the question message plus
 * `:${answerId}`, so option ranks never coincide with question ranks).
 * true_false keeps the stored order (True/False must not be reshuffled).
 */
export function orderOptions(
  attemptId: number,
  questionId: number,
  answerIds: number[],
  questionType: QuizQuestionType,
  key: Buffer = getQuizShuffleKey(),
): number[] {
  if (questionType === 'true_false') return [...answerIds];
  return sortByRank(answerIds, (answerId) => `quiz-shuffle:${attemptId}:${questionId}:${answerId}`, key);
}
