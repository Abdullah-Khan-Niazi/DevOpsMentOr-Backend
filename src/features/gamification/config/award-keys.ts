import { randomUUID } from 'node:crypto';

/**
 * Idempotency keys for `points_history` rows (contracts §5.1). The key is
 * encoded in `description` as the prefix `[k:<key>] ` followed by a human
 * label; no column or index was added. A key is written at most once per
 * user (checked under the user-row lock by `awardService.apply`).
 */

export type AwardKind =
  | 'lab_step'
  | 'lab_done'
  | 'lab_hint'
  | 'lab_wrong'
  | 'lab_guess'
  | 'quiz_wrong'
  | 'quiz_guess'
  | 'quiz_pass'
  | 'lesson'
  | 'module'
  | 'course'
  | 'achievement'
  | 'badge'
  | 'daily'
  | 'admin'
  | 'legacy';

const KEYED_KINDS: ReadonlySet<AwardKind> = new Set<AwardKind>([
  'lab_step',
  'lab_done',
  'lab_hint',
  'lab_wrong',
  'lab_guess',
  'quiz_wrong',
  'quiz_guess',
  'quiz_pass',
  'lesson',
  'module',
  'course',
  'achievement',
  'badge',
  'daily',
  'admin',
]);

/** `<kind>:<part>[:<part>...]`; parts are ids, step/hint ids, dates or UUIDs. */
export const AWARD_KEY_PATTERN = /^[a-z_]+(:[A-Za-z0-9_-]+)+$/;

/** Longest label stored after the key prefix. */
export const AWARD_LABEL_MAX_LENGTH = 200;

export const awardKeys = {
  labStep: (labId: number, stepId: string) => `lab_step:${labId}:${stepId}`,
  labDone: (labId: number) => `lab_done:${labId}`,
  labHint: (labId: number, stepId: string, hintId: string) => `lab_hint:${labId}:${stepId}:${hintId}`,
  labWrong: (labId: number, stepId: string, logId: number) => `lab_wrong:${labId}:${stepId}:${logId}`,
  labGuess: (labId: number, stepId: string, logId: number) => `lab_guess:${labId}:${stepId}:${logId}`,
  quizWrong: (attemptId: number, questionId: number) => `quiz_wrong:${attemptId}:${questionId}`,
  quizGuess: (attemptId: number, questionId: number) => `quiz_guess:${attemptId}:${questionId}`,
  quizPass: (quizId: number) => `quiz_pass:${quizId}`,
  achievement: (id: number) => `achievement:${id}`,
  badge: (id: number) => `badge:${id}`,
  admin: () => `admin:${randomUUID()}`,
} as const;

export function isValidAwardKey(key: string): boolean {
  return AWARD_KEY_PATTERN.test(key);
}

/** `[k:<key>] ` — the exact description prefix of a keyed ledger row. */
export function awardKeyPrefix(key: string): string {
  return `[k:${key}] `;
}

/** Builds the stored description; the label is trimmed and capped. */
export function formatAwardDescription(key: string, label: string): string {
  const cleanLabel = label.replace(/\s+/g, ' ').trim().slice(0, AWARD_LABEL_MAX_LENGTH);
  return `${awardKeyPrefix(key)}${cleanLabel}`;
}

/**
 * Escapes a literal for `LIKE ... ESCAPE '!'`: `_` and `%` are wildcards and
 * step/hint ids contain `_`, so an unescaped prefix would match other keys.
 */
export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (ch) => `!${ch}`);
}

const DESCRIPTION_PATTERN = /^\[k:([^\]\s]+)\] ([\s\S]*)$/;

/**
 * Splits a stored description into `{ key, kind, label }`. Rows written
 * before keys existed (or with an unknown kind) map to `legacy` with the
 * whole description as the label.
 */
export function parseAwardKey(description: string | null): {
  key: string | null;
  kind: AwardKind;
  label: string;
} {
  const text = description ?? '';
  const match = DESCRIPTION_PATTERN.exec(text);
  if (!match) {
    return { key: null, kind: 'legacy', label: text };
  }
  const key = match[1];
  const label = match[2];
  if (!isValidAwardKey(key)) {
    return { key: null, kind: 'legacy', label: text };
  }
  const prefix = key.slice(0, key.indexOf(':')) as AwardKind;
  if (!KEYED_KINDS.has(prefix)) {
    return { key, kind: 'legacy', label };
  }
  return { key, kind: prefix, label };
}
