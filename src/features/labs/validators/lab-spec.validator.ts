import { z } from 'zod';
import type { LabSpecIssue, LabSpecV2, ParsedLabSpec } from '../dto/lab-spec.dto';
import { CONTENT_DEFAULTS } from '../../gamification/config/content-defaults';

/**
 * Zod contract for the lab step spec v2 stored in `pro_labs.flag_values`
 * (contracts §2.2). Admin input and seed files are parsed with the same
 * schemas: unknown keys are rejected (`strict`), every string is bounded and
 * defaults are applied, so a stored spec always has the full shape.
 */

const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const stepIdSchema = z.string().regex(STEP_ID_PATTERN, 'Use lowercase letters, numbers, "_" or "-".');

/** A shell command run inside the learner's own lab environment via Labs /exec. */
const shellCommand = (max: number) =>
  z
    .string()
    .min(1, 'Command cannot be empty.')
    .max(max, `Command must be at most ${max} characters.`)
    .refine((v) => !v.includes('\u0000'), 'NUL bytes are not allowed.');

const timeoutMsSchema = z.number().int().min(1000).max(60000).default(15000);

const gamificationValueSchema = (max: number) => z.number().int().min(0).max(max);

// Paths are single-quote escaped by the checker as well; the pattern still
// forbids quotes, `$`, backticks and line breaks so a path can never become shell.
const absolutePathSchema = z
  .string()
  .regex(/^\/[^\u0000\r\n'"`$]{1,1023}$/, 'Use an absolute path without quotes or "$".');

const httpPathSchema = z.string().regex(/^\/[A-Za-z0-9._~/?=&%:+-]{0,511}$/, 'Use a URL path such as /health.');

const isValidRegex = (v: string): boolean => {
  try {
    new RegExp(v, 'm');
    return true;
  } catch {
    return false;
  }
};

const numericOpSchema = z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']).default('eq');

const exitCodeExpect = z
  .object({ mode: z.literal('exitCode'), value: z.number().int().min(0).max(255) })
  .strict();

const contentExpect = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('exact'), value: z.string().max(4000) }).strict(),
  z.object({ mode: z.literal('contains'), value: z.string().min(1).max(4000) }).strict(),
  z
    .object({
      mode: z.literal('regex'),
      value: z.string().min(1).max(500).refine(isValidRegex, 'Invalid regular expression.'),
    })
    .strict(),
  z.object({ mode: z.literal('numeric'), value: z.number().finite(), op: numericOpSchema }).strict(),
]);

const statusExpect = z
  .object({
    mode: z.literal('numeric'),
    value: z.number().int().min(100).max(599),
    op: numericOpSchema,
  })
  .strict();

export const labStepCheckSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('command'),
      command: shellCommand(8000),
      expect: exitCodeExpect,
      timeoutMs: timeoutMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('output'),
      command: shellCommand(8000),
      expect: contentExpect,
      timeoutMs: timeoutMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('file'),
      path: absolutePathSchema,
      expect: z.union([
        exitCodeExpect.extend({ value: z.union([z.literal(0), z.literal(1)]) }),
        contentExpect,
      ]),
      timeoutMs: timeoutMsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('http'),
      path: httpPathSchema,
      port: z.number().int().min(1).max(65535).default(80),
      expect: statusExpect,
      timeoutMs: timeoutMsSchema,
    })
    .strict(),
]);

export const labHintSchema = z
  .object({ id: stepIdSchema, text: z.string().trim().min(1).max(2000) })
  .strict();

export const labStepAnswerSchema = z
  .object({
    accepted: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    normalize: z.enum(['none', 'trim', 'trim_lower', 'collapse_ws_lower']).default('trim_lower'),
  })
  .strict();

export const labStepSchema = z
  .object({
    id: stepIdSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => !/[\r\n]/.test(v), 'Titles must be one line.'),
    instructions: z.string().trim().min(1).max(20000),
    kind: z.enum(['task', 'question']),
    setup: z.array(shellCommand(4000)).max(10).default([]),
    check: labStepCheckSchema.optional(),
    answer: labStepAnswerSchema.optional(),
    hints: z.array(labHintSchema).max(5).default([]),
    points: z.number().int().min(0).max(1000),
    hintCost: gamificationValueSchema(1000).default(CONTENT_DEFAULTS.labHintCost),
    // Penalties default per kind (question 2 / 5, task 0): see the transform below.
    wrongPenalty: gamificationValueSchema(1000).optional(),
    guessPenalty: gamificationValueSchema(1000).optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.kind === 'task' && !step.check) {
      ctx.addIssue({ code: 'custom', path: ['check'], message: 'Task steps need a check.' });
    }
    if (step.kind === 'task' && step.answer) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'Task steps cannot have answers.' });
    }
    if (step.kind === 'question' && !step.answer) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'Question steps need accepted answers.' });
    }
    if (step.kind === 'question' && step.check) {
      ctx.addIssue({ code: 'custom', path: ['check'], message: 'Question steps cannot have a check.' });
    }
    const ids = step.hints.map((h) => h.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['hints'], message: 'Hint ids must be unique.' });
    }
  })
  .transform((step) => ({
    ...step,
    wrongPenalty: step.wrongPenalty ?? (step.kind === 'question' ? CONTENT_DEFAULTS.labWrongPenalty : 0),
    guessPenalty: step.guessPenalty ?? (step.kind === 'question' ? CONTENT_DEFAULTS.labGuessPenalty : 0),
  }));

export const labSpecV2Schema = z
  .object({
    version: z.literal(2),
    mode: z.enum(['guided', 'break_fix']),
    scenario: z
      .object({
        intro: z.string().trim().max(20000).default(''),
        setup: z.array(shellCommand(4000)).max(20).default([]),
      })
      .strict(),
    completionBonus: z.number().int().min(0).max(10000).default(CONTENT_DEFAULTS.labCompletionBonus),
    steps: z.array(labStepSchema).min(1).max(50),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = spec.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Step ids must be unique.' });
    }
  });

/** What an admin/seed may send (defaults not yet applied). */
export type LabSpecV2Input = z.input<typeof labSpecV2Schema>;
export type LabStepCheckInput = z.input<typeof labStepCheckSchema>;

/** Flattens zod issues to `{ path, message }` (path joined with "."). */
export function toLabSpecIssues(error: z.ZodError): LabSpecIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runtime reader for `pro_labs.flag_values`. Never throws.
 *
 * - null / undefined / `{}` -> `missing`
 * - object with `version === 2` -> validated: `v2` (defaults applied) or `invalid`
 * - object whose values are all strings -> `legacy` (old checkpoint -> assertion map)
 * - anything else -> `invalid`
 *
 * A JSON string (double-encoded column value) is decoded once before reading.
 */
export function parseLabSpec(raw: unknown): ParsedLabSpec {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { kind: 'invalid', issues: [{ path: '', message: 'Stored spec is not valid JSON.' }] };
    }
  }

  if (value === null || value === undefined) {
    return { kind: 'missing' };
  }
  if (!isPlainObject(value)) {
    return { kind: 'invalid', issues: [{ path: '', message: 'Stored spec must be an object.' }] };
  }
  if (Object.keys(value).length === 0) {
    return { kind: 'missing' };
  }

  if ('version' in value) {
    if (value.version !== 2) {
      return {
        kind: 'invalid',
        issues: [{ path: 'version', message: 'Unsupported spec version; expected 2.' }],
      };
    }
    const result = labSpecV2Schema.safeParse(value);
    if (!result.success) {
      return { kind: 'invalid', issues: toLabSpecIssues(result.error) };
    }
    const spec: LabSpecV2 = result.data;
    return { kind: 'v2', spec };
  }

  if (Object.values(value).every((v) => typeof v === 'string')) {
    return { kind: 'legacy' };
  }
  return { kind: 'invalid', issues: [{ path: '', message: 'Stored spec has an unknown shape.' }] };
}

/**
 * Non-blocking authoring warnings returned by admin validate/save. The spec
 * is valid either way; these flag likely mistakes.
 */
export function lintLabSpec(spec: LabSpecV2): string[] {
  const warnings: string[] = [];
  for (const step of spec.steps) {
    if (step.hints.length === 0) {
      warnings.push(`Step ${step.id} has no hints`);
    }
    if (step.setup.length > 0) {
      warnings.push(`Step ${step.id} setup runs on every stage of a new environment`);
    }
    if (step.kind === 'task' && (step.wrongPenalty > 0 || step.guessPenalty > 0)) {
      warnings.push(`Step ${step.id} has a wrong-answer or guess penalty but is a task step`);
    }
  }
  const totalPoints = spec.steps.reduce((sum, step) => sum + step.points, 0);
  if (totalPoints === 0) {
    warnings.push('Total points is 0');
  }
  return warnings;
}
