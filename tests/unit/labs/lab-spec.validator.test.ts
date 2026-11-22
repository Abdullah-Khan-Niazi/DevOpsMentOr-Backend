import { describe, expect, it } from 'vitest';
import {
  labSpecV2Schema,
  labStepCheckSchema,
  labStepSchema,
  lintLabSpec,
  parseLabSpec,
} from '../../../src/features/labs/validators/lab-spec.validator';
import type { LabSpecV2 } from '../../../src/features/labs/dto/lab-spec.dto';

function taskStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'step_1',
    title: 'Create the report',
    instructions: 'Write `free -m` into /workspace/report.txt.',
    kind: 'task',
    check: { type: 'command', command: 'test -s /workspace/report.txt', expect: { mode: 'exitCode', value: 0 } },
    hints: [{ id: 'h1', text: 'Use output redirection.' }],
    points: 25,
    ...overrides,
  };
}

function questionStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'q-1',
    title: 'Which PID?',
    instructions: 'Find the PID of the rogue worker.',
    kind: 'question',
    answer: { accepted: ['1234'] },
    points: 10,
    ...overrides,
  };
}

function spec(steps: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 2, mode: 'guided', scenario: {}, steps, ...overrides };
}

function issuesOf(result: { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } }) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('labSpecV2Schema', () => {
  it('accepts a minimal spec and applies defaults', () => {
    const parsed = labSpecV2Schema.parse(spec([taskStep(), questionStep()]));
    expect(parsed.scenario).toEqual({ intro: '', setup: [] });
    expect(parsed.steps[0].setup).toEqual([]);
    expect(parsed.steps[0].check).toMatchObject({ timeoutMs: 15000 });
    expect(parsed.steps[1].hints).toEqual([]);
    expect(parsed.steps[1].answer).toEqual({ accepted: ['1234'], normalize: 'trim_lower' });
  });

  it('rejects unknown keys at every level (strict)', () => {
    expect(labSpecV2Schema.safeParse({ ...spec([taskStep()]), extra: 1 }).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec([taskStep({ xp: 50 })])).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { scenario: { intro: '', secret: 'x' } })).success).toBe(false);
    expect(
      labStepCheckSchema.safeParse({ type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 }, passed: true })
        .success,
    ).toBe(false);
  });

  it('requires version 2, a known mode, and 1..50 steps', () => {
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { version: 1 })).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { mode: 'ctf' })).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec([])).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => taskStep({ id: `s${i}` }));
    expect(labSpecV2Schema.safeParse(spec(many)).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec(many.slice(0, 50))).success).toBe(true);
  });

  it('rejects duplicate step ids', () => {
    const result = labSpecV2Schema.safeParse(spec([taskStep(), taskStep()]));
    expect(issuesOf(result)).toContain('steps: Step ids must be unique.');
  });

  it('validates step and hint ids', () => {
    for (const id of ['Step1', '-a', 'a b', '', 'a'.repeat(65), 'a.b']) {
      expect(labStepSchema.safeParse(taskStep({ id })).success).toBe(false);
    }
    for (const id of ['a', '0', 'checkpoint_1_ps', 'q-1', 'a'.repeat(64)]) {
      expect(labStepSchema.safeParse(taskStep({ id })).success).toBe(true);
    }
    expect(labStepSchema.safeParse(taskStep({ hints: [{ id: 'H1', text: 'x' }] })).success).toBe(false);
  });

  it('rejects duplicate hint ids and more than 5 hints', () => {
    const duplicate = labStepSchema.safeParse(
      taskStep({ hints: [{ id: 'h1', text: 'a' }, { id: 'h1', text: 'b' }] }),
    );
    expect(issuesOf(duplicate)).toContain('hints: Hint ids must be unique.');
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, text: 'x' }));
    expect(labStepSchema.safeParse(taskStep({ hints: six })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ hints: [{ id: 'h1', text: '   ' }] })).success).toBe(false);
  });

  it('enforces task XOR question', () => {
    expect(issuesOf(labStepSchema.safeParse(taskStep({ check: undefined })))).toContain('check: Task steps need a check.');
    expect(issuesOf(labStepSchema.safeParse(taskStep({ answer: { accepted: ['x'] } })))).toContain(
      'answer: Task steps cannot have answers.',
    );
    expect(issuesOf(labStepSchema.safeParse(questionStep({ answer: undefined })))).toContain(
      'answer: Question steps need accepted answers.',
    );
    expect(
      issuesOf(
        labStepSchema.safeParse(
          questionStep({ check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } } }),
        ),
      ),
    ).toContain('check: Question steps cannot have a check.');
  });

  it('bounds titles, instructions, points, setup and answers', () => {
    expect(labStepSchema.safeParse(taskStep({ title: 'two\nlines' })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ title: 'x'.repeat(121) })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ instructions: '  ' })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ instructions: 'x'.repeat(20001) })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ points: -1 })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ points: 1001 })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ points: 2.5 })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ setup: Array.from({ length: 11 }, () => 'true') })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ setup: ['x'.repeat(4001)] })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ setup: [''] })).success).toBe(false);
    expect(labStepSchema.safeParse(questionStep({ answer: { accepted: [] } })).success).toBe(false);
    expect(
      labStepSchema.safeParse(questionStep({ answer: { accepted: Array.from({ length: 21 }, () => 'a') } })).success,
    ).toBe(false);
    expect(labStepSchema.safeParse(questionStep({ answer: { accepted: ['a'], normalize: 'fuzzy' } })).success).toBe(
      false,
    );
  });

  it('bounds scenario intro and setup', () => {
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { scenario: { intro: 'x'.repeat(20001) } })).success).toBe(false);
    expect(
      labSpecV2Schema.safeParse(spec([taskStep()], { scenario: { setup: Array.from({ length: 21 }, () => 'true') } }))
        .success,
    ).toBe(false);
  });
});

describe('labStepCheckSchema', () => {
  const command = (overrides: Record<string, unknown> = {}) => ({
    type: 'command',
    command: 'true',
    expect: { mode: 'exitCode', value: 0 },
    ...overrides,
  });

  it('command: exit code 0..255 only, NUL bytes and empty commands rejected', () => {
    expect(labStepCheckSchema.safeParse(command()).success).toBe(true);
    expect(labStepCheckSchema.safeParse(command({ expect: { mode: 'exitCode', value: 256 } })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ expect: { mode: 'contains', value: 'x' } })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ command: 'echo \u0000' })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ command: '' })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ command: 'x'.repeat(8001) })).success).toBe(false);
  });

  it('timeouts are 1..60 s and default to 15 s', () => {
    expect(labStepCheckSchema.parse(command()).timeoutMs).toBe(15000);
    expect(labStepCheckSchema.safeParse(command({ timeoutMs: 999 })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ timeoutMs: 60001 })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(command({ timeoutMs: 60000 })).success).toBe(true);
  });

  it('output: content matchers only; regex must compile; numeric op defaults to eq', () => {
    const output = (expect: unknown) => ({ type: 'output', command: 'cat /x', expect });
    expect(labStepCheckSchema.safeParse(output({ mode: 'exact', value: '' })).success).toBe(true);
    expect(labStepCheckSchema.safeParse(output({ mode: 'contains', value: '' })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(output({ mode: 'regex', value: '^ok$' })).success).toBe(true);
    expect(labStepCheckSchema.safeParse(output({ mode: 'regex', value: '(' })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(output({ mode: 'exitCode', value: 0 })).success).toBe(false);
    const numeric = labStepCheckSchema.parse(output({ mode: 'numeric', value: 3 }));
    expect(numeric.expect).toEqual({ mode: 'numeric', value: 3, op: 'eq' });
    expect(labStepCheckSchema.safeParse(output({ mode: 'numeric', value: Infinity })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(output({ mode: 'numeric', value: 1, op: 'approx' })).success).toBe(false);
  });

  it('file: absolute path without quotes/$/backticks/newlines; exit code limited to 0 or 1', () => {
    const file = (overrides: Record<string, unknown>) => ({
      type: 'file',
      path: '/etc/app/config.env',
      expect: { mode: 'exitCode', value: 0 },
      ...overrides,
    });
    expect(labStepCheckSchema.safeParse(file({})).success).toBe(true);
    expect(labStepCheckSchema.safeParse(file({ expect: { mode: 'exitCode', value: 1 } })).success).toBe(true);
    expect(labStepCheckSchema.safeParse(file({ expect: { mode: 'exitCode', value: 2 } })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(file({ expect: { mode: 'contains', value: 'STATUS=active' } })).success).toBe(
      true,
    );
    for (const bad of ['relative/path', "/tmp/a'b", '/tmp/a"b', '/tmp/$HOME', '/tmp/`id`', '/tmp/a\nb', '/']) {
      expect(labStepCheckSchema.safeParse(file({ path: bad })).success).toBe(false);
    }
  });

  it('http: path allowlist, port 1..65535 (default 80), status 100..599', () => {
    const http = (overrides: Record<string, unknown>) => ({
      type: 'http',
      path: '/health',
      expect: { mode: 'numeric', value: 200 },
      ...overrides,
    });
    expect(labStepCheckSchema.parse(http({}))).toMatchObject({ port: 80, expect: { op: 'eq' } });
    expect(labStepCheckSchema.safeParse(http({ path: '/api/v1/items?x=1&y=%20' })).success).toBe(true);
    for (const bad of ['health', '/a b', '/a;rm', '/a$(id)', 'http://evil.example/']) {
      expect(labStepCheckSchema.safeParse(http({ path: bad })).success).toBe(false);
    }
    expect(labStepCheckSchema.safeParse(http({ port: 0 })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(http({ port: 65536 })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(http({ expect: { mode: 'numeric', value: 99 } })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(http({ expect: { mode: 'numeric', value: 600 } })).success).toBe(false);
    expect(labStepCheckSchema.safeParse(http({ expect: { mode: 'contains', value: 'ok' } })).success).toBe(false);
  });

  it('rejects unknown check types', () => {
    expect(labStepCheckSchema.safeParse({ type: 'sql', command: 'select 1', expect: { mode: 'exitCode', value: 0 } }).success).toBe(
      false,
    );
  });
});

describe('parseLabSpec', () => {
  it('returns missing for null, undefined and an empty object', () => {
    expect(parseLabSpec(null)).toEqual({ kind: 'missing' });
    expect(parseLabSpec(undefined)).toEqual({ kind: 'missing' });
    expect(parseLabSpec({})).toEqual({ kind: 'missing' });
  });

  it('returns legacy for the old checkpoint -> assertion group map', () => {
    expect(parseLabSpec({ checkpoint_1_ps: 'lab01-checkpoint-1-ps' })).toEqual({ kind: 'legacy' });
  });

  it('returns v2 with defaults applied for a valid spec (also when double-encoded)', () => {
    const raw = spec([taskStep()]);
    const parsed = parseLabSpec(raw);
    expect(parsed.kind).toBe('v2');
    if (parsed.kind === 'v2') expect(parsed.spec.steps[0].setup).toEqual([]);
    expect(parseLabSpec(JSON.stringify(raw)).kind).toBe('v2');
  });

  it('returns invalid with issues for a broken v2 spec, another version, arrays and scalars', () => {
    const broken = parseLabSpec(spec([taskStep({ check: undefined })]));
    expect(broken.kind).toBe('invalid');
    if (broken.kind === 'invalid') {
      expect(broken.issues).toContainEqual({ path: 'steps.0.check', message: 'Task steps need a check.' });
    }
    expect(parseLabSpec({ version: 3, steps: [] }).kind).toBe('invalid');
    expect(parseLabSpec([1, 2]).kind).toBe('invalid');
    expect(parseLabSpec(42).kind).toBe('invalid');
    expect(parseLabSpec('{not json').kind).toBe('invalid');
    expect(parseLabSpec({ a: 'x', b: 2 }).kind).toBe('invalid');
  });

  it('never throws', () => {
    for (const raw of [Symbol('x'), () => 1, new Date(), { version: 2 }, { version: 2, steps: 'x' }]) {
      expect(() => parseLabSpec(raw)).not.toThrow();
    }
  });
});

describe('gamification values on lab steps and spec', () => {
  it('applies authoring defaults for omitted question-step values and the completion bonus', () => {
    const parsed = labSpecV2Schema.parse(spec([questionStep()]));
    expect(parsed.completionBonus).toBe(50);
    expect(parsed.steps[0]).toMatchObject({ hintCost: 5, wrongPenalty: 2, guessPenalty: 5 });
  });

  it('defaults task-step penalties to 0 while keeping the hint cost default', () => {
    const parsed = labStepSchema.parse(taskStep());
    expect(parsed).toMatchObject({ hintCost: 5, wrongPenalty: 0, guessPenalty: 0 });
  });

  it('keeps explicit values', () => {
    const parsed = labStepSchema.parse(questionStep({ hintCost: 0, wrongPenalty: 7, guessPenalty: 0 }));
    expect(parsed).toMatchObject({ hintCost: 0, wrongPenalty: 7, guessPenalty: 0 });
    expect(labSpecV2Schema.parse(spec([questionStep()], { completionBonus: 0 })).completionBonus).toBe(0);
  });

  it('rejects hint costs outside 0..1000', () => {
    expect(labStepSchema.safeParse(taskStep({ hintCost: -1 })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ hintCost: 1001 })).success).toBe(false);
    expect(labStepSchema.safeParse(taskStep({ hintCost: 1000 })).success).toBe(true);
  });

  it('rejects penalties outside 0..1000', () => {
    expect(labStepSchema.safeParse(questionStep({ wrongPenalty: -1 })).success).toBe(false);
    expect(labStepSchema.safeParse(questionStep({ guessPenalty: 1001 })).success).toBe(false);
  });

  it('rejects a completion bonus above 10000', () => {
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { completionBonus: 10001 })).success).toBe(false);
    expect(labSpecV2Schema.safeParse(spec([taskStep()], { completionBonus: 10000 })).success).toBe(true);
  });

  it('rejects the retired generic "penalty" key (strict)', () => {
    expect(labStepSchema.safeParse(taskStep({ penalty: 3 })).success).toBe(false);
  });
});

describe('lintLabSpec', () => {
  it('warns about steps without hints, step setup and zero total points', () => {
    const parsed = labSpecV2Schema.parse(
      spec([taskStep({ hints: [], points: 0, setup: ['systemctl stop nginx'] }), questionStep({ points: 0 })]),
    ) as LabSpecV2;
    expect(lintLabSpec(parsed)).toEqual([
      'Step step_1 has no hints',
      'Step step_1 setup runs on every stage of a new environment',
      'Step q-1 has no hints',
      'Total points is 0',
    ]);
  });

  it('returns no warnings for a well-formed spec', () => {
    expect(lintLabSpec(labSpecV2Schema.parse(spec([taskStep()])) as LabSpecV2)).toEqual([]);
  });

  it('warns about a task step with a guess penalty', () => {
    const parsed = labSpecV2Schema.parse(spec([taskStep({ guessPenalty: 3 })])) as LabSpecV2;
    expect(lintLabSpec(parsed)).toEqual([
      'Step step_1 has a wrong-answer or guess penalty but is a task step',
    ]);
  });
});
