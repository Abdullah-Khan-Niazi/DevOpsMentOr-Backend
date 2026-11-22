/**
 * Authoring defaults for gamification values that live on the content rows
 * (contracts §3, §11.3).
 *
 * These are AUTHORING defaults only: they are applied by zod `.default()` and
 * by the importer, and used by the FE builders to pre-fill forms. They are
 * never read at award time; awards read the stored values from the content
 * (`steps[].points`, `steps[].hintCost`, `steps[].wrongPenalty`,
 * `steps[].guessPenalty`, `flag_values.completionBonus`, quiz question config).
 */
export const CONTENT_DEFAULTS = {
  labStepPoints: 25,
  labHintCost: 5,
  labWrongPenalty: 2,
  labGuessPenalty: 5,
  labCompletionBonus: 50,
  quizQuestionPoints: 10,
  quizWrongPenalty: 2,
  quizGuessPenalty: 5,
} as const;
