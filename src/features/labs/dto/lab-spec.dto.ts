/**
 * Lab step spec v2, stored verbatim in `pro_labs.flag_values` (contracts §2).
 *
 * The spec is the single source of a lab's ordered steps, instructions,
 * hints and server-side checks. Fields marked "server only" (`check`,
 * `setup`, `answer`, `scenario.setup`, unrevealed `hints`) are NEVER
 * serialized to learners: learner DTOs are built field by field from it.
 */

export type LabMode = 'guided' | 'break_fix';
export type LabStepKind = 'task' | 'question';
export type LabCheckType = 'command' | 'file' | 'output' | 'http';
export type LabExpectMode = 'exitCode' | 'exact' | 'contains' | 'regex' | 'numeric';
export type LabNumericOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
export type LabAnswerNormalize = 'none' | 'trim' | 'trim_lower' | 'collapse_ws_lower';

export type LabStepExpect =
  | { mode: 'exitCode'; value: number }
  | { mode: 'exact'; value: string }
  | { mode: 'contains'; value: string }
  | { mode: 'regex'; value: string }
  | { mode: 'numeric'; value: number; op: LabNumericOp };

/**
 * Semantics:
 * - `command`: run `command`; pass iff exit code === `expect.value`.
 * - `output`: run `command`; pass iff exit code is 0 AND trimmed stdout satisfies `expect`.
 * - `file`: `exitCode` expect -> `test -e '<path>'` (0 = must exist, 1 = must not exist);
 *   other modes -> `cat -- '<path>'`, pass iff exit 0 and the content satisfies `expect`.
 * - `http`: Labs `POST /instances/:id/http`; pass iff `compare(statusCode, op, value)`.
 * A timed out command never passes.
 */
export type LabStepCheck =
  | {
      type: 'command';
      command: string;
      expect: Extract<LabStepExpect, { mode: 'exitCode' }>;
      timeoutMs: number;
    }
  | {
      type: 'output';
      command: string;
      expect: Exclude<LabStepExpect, { mode: 'exitCode' }>;
      timeoutMs: number;
    }
  | { type: 'file'; path: string; expect: LabStepExpect; timeoutMs: number }
  | {
      type: 'http';
      path: string;
      port: number;
      expect: Extract<LabStepExpect, { mode: 'numeric' }>;
      timeoutMs: number;
    };

/** Accepted answers for a `question` step (server only). */
export interface LabStepAnswer {
  accepted: string[];
  normalize: LabAnswerNormalize;
}

export interface LabHint {
  id: string;
  text: string;
}

export interface LabStepV2 {
  id: string;
  title: string;
  /** Markdown, stored verbatim; the frontend sanitizes on render. */
  instructions: string;
  kind: LabStepKind;
  /** Shell commands run via Labs `/exec` when the step is staged (server only). */
  setup: string[];
  /** `kind === 'task'` only (server only). */
  check?: LabStepCheck;
  /** `kind === 'question'` only (server only). */
  answer?: LabStepAnswer;
  /** Text is returned only by the reveal endpoint and for already revealed hints. */
  hints: LabHint[];
  /** Base points, scaled by `difficulty_levels.points_multiplier` at award time. */
  points: number;
  /** Points deducted per hint reveal of this step (0..1000, default 5). */
  hintCost: number;
  /** Question steps: deducted per wrong answer (0..1000, default 2). Task steps: 0. */
  wrongPenalty: number;
  /** Question steps: deducted for an answer without a shell command since stage (0..1000, default 5). Task steps: 0. */
  guessPenalty: number;
}

export interface LabSpecV2 {
  version: 2;
  mode: LabMode;
  /** `setup` is server only. */
  scenario: { intro: string; setup: string[] };
  /** Awarded once per lab when every step passed (0..10000, default 50), scaled by the multiplier. */
  completionBonus: number;
  steps: LabStepV2[];
}

export interface LabSpecIssue {
  path: string;
  message: string;
}

/** Outcome of reading a stored `flag_values` value (`parseLabSpec`). */
export type ParsedLabSpec =
  | { kind: 'v2'; spec: LabSpecV2 }
  /** Pre-v2 `{ checkpointId: assertionGroupId }` map: not runnable (LAB_NOT_READY). */
  | { kind: 'legacy' }
  /** NULL / absent: not runnable (LAB_NOT_READY). */
  | { kind: 'missing' }
  /** Stored value fails validation (LAB_MISCONFIGURED). */
  | { kind: 'invalid'; issues: LabSpecIssue[] };
