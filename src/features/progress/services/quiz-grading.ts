import { ERROR_CODES, ValidationError } from '../../../shared/errors';
import type { QuizAnswerResponse, QuizQuestionType } from '../dto/progress.dto';

/**
 * Pure quiz grading and response-shape checks. No DB, no I/O.
 * Terminal `check` questions are graded by the attempt service (lab check), never here.
 */

export interface GradableAnswer {
  answerId: number;
  answerText: string;
  isCorrect: boolean;
  /** Correct position for ordering options and bucket for bucket_sort cards; null otherwise. */
  answerOrder: number | null;
}

export interface GradableQuestion {
  questionId: number;
  questionType: QuizQuestionType;
  answers: GradableAnswer[];
  /** quiz_questions.config (validated on write; read defensively here). */
  config: unknown;
}

/** Lower-case and collapse runs of whitespace, for accepted text answers. */
export function collapseWsLower(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function configRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function terminalConfig(config: unknown): { mode: 'answer' | 'check'; answerFormat: 'choice' | 'text' | null } {
  const terminal = configRecord(configRecord(config).terminal);
  if (terminal.mode !== 'answer' && terminal.mode !== 'check') {
    throw new Error('Terminal question config has no valid mode.');
  }
  if (terminal.mode === 'check') return { mode: 'check', answerFormat: null };
  if (terminal.answerFormat !== 'choice' && terminal.answerFormat !== 'text') {
    throw new Error('Terminal answer question config has no valid answerFormat.');
  }
  return { mode: 'answer', answerFormat: terminal.answerFormat };
}

function bucketCount(config: unknown): number {
  const buckets = configRecord(config).buckets;
  return Array.isArray(buckets) ? buckets.length : 0;
}

/** Response type a question accepts (terminal depends on config.terminal). */
export function expectedResponseType(question: GradableQuestion): QuizAnswerResponse['type'] {
  switch (question.questionType) {
    case 'multiple_choice':
    case 'true_false':
      return 'choice';
    case 'multiple_select':
      return 'multi';
    case 'fill_blank':
      return 'text';
    case 'ordering':
      return 'ordering';
    case 'bucket_sort':
      return 'buckets';
    case 'terminal': {
      const terminal = terminalConfig(question.config);
      if (terminal.mode === 'check') return 'terminal_check';
      return terminal.answerFormat === 'text' ? 'text' : 'choice';
    }
    default:
      throw new Error(`Unknown quiz question type: ${String(question.questionType)}`);
  }
}

function shapeError(): ValidationError {
  return new ValidationError('That answer does not fit this question.', [{ code: ERROR_CODES.INVALID_ANSWER_SHAPE }]);
}

/** Every id is a known answer of the question and appears at most once. */
function assertKnownUniqueIds(ids: number[], known: Set<number>): void {
  const seen = new Set<number>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) throw shapeError();
    seen.add(id);
  }
}

/** Throws the 422 INVALID_ANSWER_SHAPE error when the response does not fit the question. */
export function assertResponseShape(question: GradableQuestion, response: QuizAnswerResponse): void {
  if (response.type !== expectedResponseType(question)) throw shapeError();

  const known = new Set(question.answers.map((a) => a.answerId));

  switch (response.type) {
    case 'choice':
      if (!known.has(response.answerId)) throw shapeError();
      return;
    case 'multi':
      assertKnownUniqueIds(response.answerIds, known);
      return;
    case 'text':
    case 'terminal_check':
      return;
    case 'ordering':
      assertKnownUniqueIds(response.answerIds, known);
      if (response.answerIds.length !== known.size) throw shapeError();
      return;
    case 'buckets': {
      const cardIds = response.placements.map((p) => p.answerId);
      assertKnownUniqueIds(cardIds, known);
      if (cardIds.length !== known.size) throw shapeError();
      const buckets = bucketCount(question.config);
      if (response.placements.some((p) => p.bucket > buckets)) throw shapeError();
      return;
    }
  }
}

/**
 * Grades a validated response. Throws on a shape mismatch (see assertResponseShape) and
 * on terminal_check, which the attempt service grades with the lab check.
 */
export function gradeResponse(question: GradableQuestion, response: QuizAnswerResponse): boolean {
  if (response.type === 'terminal_check') {
    throw new Error('terminal_check responses are graded by the quiz attempt service, not gradeResponse.');
  }
  assertResponseShape(question, response);

  switch (response.type) {
    case 'choice': {
      const chosen = question.answers.find((a) => a.answerId === response.answerId);
      return chosen?.isCorrect === true;
    }
    case 'multi': {
      const correct = new Set(question.answers.filter((a) => a.isCorrect).map((a) => a.answerId));
      return correct.size === response.answerIds.length && response.answerIds.every((id) => correct.has(id));
    }
    case 'text': {
      const submitted = collapseWsLower(response.text);
      return question.answers.some((a) => a.isCorrect && collapseWsLower(a.answerText) === submitted);
    }
    case 'ordering': {
      if (question.answers.some((a) => a.answerOrder === null)) {
        throw new Error('Ordering question has an answer without answerOrder.');
      }
      const correctOrder = [...question.answers].sort((a, b) => (a.answerOrder ?? 0) - (b.answerOrder ?? 0));
      return response.answerIds.every((id, index) => id === correctOrder[index]?.answerId);
    }
    case 'buckets': {
      const byId = new Map(question.answers.map((a) => [a.answerId, a]));
      return response.placements.every((p) => {
        const card = byId.get(p.answerId);
        return card !== undefined && card.answerOrder === p.bucket;
      });
    }
  }
}
