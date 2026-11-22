/**
 * Operational quiz limits. Code constants, not DB rows (contract section 3 / 11.3).
 * `maxAttemptsPerDay` counts attempts started in a rolling 24 h window; 0 means unlimited.
 */
export const QUIZ_LIMITS = {
  maxAttemptsPerDay: 5,
  retryCooldownSeconds: 120,
} as const;
