import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabStepService, type LabStepServiceDeps } from '../../../src/features/labs/services/LabStepService';
import { awardKeys } from '../../../src/features/gamification/config/award-keys';

/* The service reads the ledger and the running balance straight from `db`. */
const ledger = vi.hoisted(() => ({ rows: [] as Array<{ description: string; pointsChange: number }>, balance: 40 }));

vi.mock('../../../src/app/database', () => {
  const builder = (fields?: Record<string, unknown>) => {
    const keys = fields ? Object.keys(fields) : [];
    const b = {
      from() { return b; },
      where() { return b; },
      orderBy() { return b; },
      limit() { return b; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const rows = keys.includes('balance') ? [{ balance: ledger.balance }] : ledger.rows;
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return b;
  };
  return { db: { select: (fields?: Record<string, unknown>) => builder(fields) } };
});
vi.mock('../../../src/app/cache/redis', () => ({ redisClient: { set: vi.fn(), eval: vi.fn() } }));

const USER = 7;
const LAB = 1;
const INSTANCE = 42;

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, instructions: `INSTR-${id}`, kind: 'task', setup: [],
  check: { type: 'command', command: 'echo SECRET-CHECK', expect: { mode: 'exitCode', value: 0 } },
  hints: [], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0, ...extra,
});

function specWith(steps: unknown[], completionBonus = 50) {
  return { version: 2, mode: 'guided', scenario: { intro: 'Scenario intro', setup: ['echo SCENARIO-SETUP'] }, completionBonus, steps };
}

const s1 = task('s1', { hints: [{ id: 'h1', text: 'HINT-ONE' }, { id: 'h2', text: 'HINT-TWO' }] });
const s2 = task('s2', { setup: ['mkdir /srv/x'] });
const s3 = {
  id: 's3', title: 'Question', instructions: 'INSTR-s3', kind: 'question', setup: [],
  answer: { accepted: ['Nginx'], normalize: 'trim_lower' }, hints: [{ id: 'q1', text: 'HINT-Q' }],
  points: 10, hintCost: 3, wrongPenalty: 2, guessPenalty: 5,
};

interface ActivityRow { activityId: number; activityType: string; details: Record<string, unknown>; createdAt: Date }

function harness(opts: { steps?: unknown[]; multiplier?: number; completionBonus?: number; lab?: unknown; flagValues?: unknown } = {}) {
  const rows: ActivityRow[] = [];
  let nextId = 1;
  const add = (activityType: string, details: Record<string, unknown>): number => {
    const activityId = nextId++;
    rows.push({ activityId, activityType, details, createdAt: new Date() });
    return activityId;
  };
  const flagValues = 'flagValues' in opts ? opts.flagValues : specWith(opts.steps ?? [s1, s2, s3], opts.completionBonus ?? 50);
  const repo = {
    findLabById: vi.fn(async () => ('lab' in opts ? opts.lab : { labId: LAB, slug: 'C01M01L01', labName: 'Linux Lab', isActive: true })),
    findProLabByLabId: vi.fn(async () => ({ flagValues })),
    getPointsMultiplier: vi.fn(async () => opts.multiplier ?? 1),
    findInstanceForUser: vi.fn(async () => ({ instanceId: INSTANCE, userId: USER, labId: LAB, labType: 'pro_lab', status: 'running', expiresAt: new Date('2030-01-01') })),
    findAnyActiveInstanceForUser: vi.fn(async () => ({ instanceId: INSTANCE, userId: USER, labId: LAB, status: 'running', expiresAt: new Date('2030-01-01') })),
    findLabStartTime: vi.fn(async () => new Date(Date.now() - 120_000)),
    listLabActivity: vi.fn(async (_u: number, labId: number, types: string[]) =>
      rows.filter((r) => types.includes(r.activityType) && r.details.labId === labId)),
    findLatestStageRecord: vi.fn(async (_u: number, instanceId: number, stepId: string) =>
      [...rows].reverse().find((r) => r.activityType === 'LAB_STEP_STAGED' && r.details.instanceId === instanceId && r.details.stepId === stepId) ?? null),
    insertActivity: vi.fn(async (input: { activityType: string; details: Record<string, unknown> }) => add(input.activityType, input.details)),
    updateInstanceExpiry: vi.fn(async () => undefined),
  };
  const award = {
    withUserLock: vi.fn(async (_u: number, fn: (tx: unknown) => unknown) => fn({ tag: 'tx' })),
    apply: vi.fn(async (_tx: unknown, input: { points: number }) => ({ applied: true, historyId: 1, pointsChange: input.points, balance: 0 })),
    balance: vi.fn(async () => 100),
  };
  const deps = {
    repo,
    orchestration: { getInstance: vi.fn(async () => ({ terminalWsUrl: 'wss://t/42' })) },
    entitlement: { assertLabAccess: vi.fn(async () => undefined) },
    check: {
      evaluate: vi.fn(async () => ({ passed: true, reason: 'passed' })),
      runSetup: vi.fn(async () => undefined),
      readHistoryCount: vi.fn(async () => 10),
    },
    award,
    activity: { recordEvent: vi.fn(async (_u: number, type: string, details: Record<string, unknown>) => { add(type, details); }) },
    progress: { completeLabItems: vi.fn(async () => [201]), afterCommit: vi.fn(async () => undefined) },
    gamification: { afterLearningEvent: vi.fn(async () => undefined) },
    redis: { set: vi.fn(async () => 'OK'), eval: vi.fn(async () => 1) },
  };
  const service = new LabStepService(deps as unknown as LabStepServiceDeps);
  const mark = (activityType: string, details: Record<string, unknown> = {}) => add(activityType, { labId: LAB, ...details });
  const passStep = (stepId: string) => mark('LAB_STEP_PASSED', { stepId });
  const stage = (stepId: string, historyCount = 10) => mark('LAB_STEP_STAGED', { stepId, instanceId: INSTANCE, historyCount });
  return { service, deps, rows, mark, passStep, stage, award };
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger.rows = [];
  ledger.balance = 40;
});

describe('LabStepService.getState', () => {
  it('derives locked, current and passed and hides the instructions of locked steps', async () => {
    const h = harness();
    h.passStep('s1');
    const state = await h.service.getState(USER, LAB);
    expect(state.steps.map((s) => s.status)).toEqual(['passed', 'current', 'locked']);
    expect(state.currentStepId).toBe('s2');
    expect(state.steps[2].instructions).toBeNull();
    expect(state.steps[1].instructions).toBe('INSTR-s2');
    expect(state.steps[1].requiresStage).toBe(true);
    expect(state.steps[0].requiresStage).toBe(false);
  });

  it('has no current step once every step is passed', async () => {
    const h = harness();
    for (const id of ['s1', 's2', 's3']) h.passStep(id);
    h.mark('LAB_COMPLETED');
    const state = await h.service.getState(USER, LAB);
    expect(state.currentStepId).toBeNull();
    expect(state.completedAt).not.toBeNull();
  });

  it('returns hint text only for revealed indexes and the cost from the step', async () => {
    const h = harness();
    h.mark('LAB_HINT_REVEALED', { stepId: 's1', hintId: 'h1', hintIndex: 0 });
    const state = await h.service.getState(USER, LAB);
    expect(state.steps[0].hints).toEqual({
      total: 2, revealed: [{ hintIndex: 0, text: 'HINT-ONE' }], nextHintIndex: 1, cost: 5,
    });
    expect(state.steps[2].hints.cost).toBe(3);
    expect(JSON.stringify(state)).not.toContain('HINT-TWO');
    expect(JSON.stringify(state)).not.toContain('HINT-Q');
  });

  it('never exposes checks, setup, accepted answers or unrevealed hints', async () => {
    const h = harness();
    const json = JSON.stringify(await h.service.getState(USER, LAB));
    for (const secret of ['SECRET-CHECK', 'SCENARIO-SETUP', 'mkdir /srv/x', 'Nginx', '"accepted"', '"check"']) {
      expect(json).not.toContain(secret);
    }
  });

  it('scales points by the multiplier and reports question penalties only for question steps', async () => {
    const h = harness({ multiplier: 2 });
    const state = await h.service.getState(USER, LAB);
    expect(state.steps[0].points).toBe(50);
    expect(state.completionBonus).toBe(100);
    expect(state.totals.pointsAvailable).toBe(50 + 50 + 20 + 100);
    expect(state.steps[0].penalties).toEqual({ wrongAnswer: 0, guess: 0 });
    expect(state.steps[2].penalties).toEqual({ wrongAnswer: 2, guess: 5 });
  });

  it('sums the ledger into totals and per-step pointsAwarded', async () => {
    ledger.rows = [
      { description: `[k:${awardKeys.labStep(LAB, 's1')}] Step passed`, pointsChange: 25 },
      { description: `[k:${awardKeys.labHint(LAB, 's1', 'h1')}] Hint`, pointsChange: -5 },
      { description: `[k:${awardKeys.labWrong(LAB, 's3', 9)}] Wrong`, pointsChange: -2 },
      { description: `[k:${awardKeys.labStep(99, 's1')}] other lab`, pointsChange: 25 },
    ];
    const h = harness();
    h.passStep('s1');
    const state = await h.service.getState(USER, LAB);
    expect(state.steps[0].pointsAwarded).toBe(25);
    expect(state.totals).toMatchObject({ pointsEarned: 25, hintPenalties: 5, wrongAnswerPenalties: 2, guessPenalties: 0 });
  });

  it('reports a running instance of another lab as otherActiveInstance', async () => {
    const h = harness();
    h.deps.repo.findAnyActiveInstanceForUser.mockResolvedValue({ instanceId: 5, labId: 99, status: 'running' } as never);
    h.deps.repo.findLabById.mockImplementation((async (id: number) => ({ labId: id, labName: id === 99 ? 'Other Lab' : 'Linux Lab', isActive: true, slug: 'x' })) as never);
    const state = await h.service.getState(USER, LAB);
    expect(state.activeInstance).toBeNull();
    expect(state.otherActiveInstance).toEqual({ instanceId: 5, labId: 99, labName: 'Other Lab' });
  });

  it('404s an inactive or missing lab, 409s LAB_NOT_READY and LAB_MISCONFIGURED', async () => {
    await expect(harness({ lab: null }).service.getState(USER, LAB)).rejects.toMatchObject({ statusCode: 404 });
    await expect(harness({ lab: { labId: LAB, isActive: false } }).service.getState(USER, LAB)).rejects.toMatchObject({ statusCode: 404 });
    await expect(harness({ flagValues: null }).service.getState(USER, LAB)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'LAB_NOT_READY' }] });
    await expect(harness({ flagValues: { version: 2, steps: 'bad' } }).service.getState(USER, LAB)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'LAB_MISCONFIGURED' }] });
  });
});

describe('LabStepService.stage', () => {
  it('runs setup under the mutex, records LAB_STEP_STAGED once and releases the lock', async () => {
    const h = harness();
    h.passStep('s1');
    const result = await h.service.stage(USER, INSTANCE, 's2');
    expect(result).toMatchObject({ stepId: 's2', instanceId: INSTANCE, setupRan: true });
    expect(h.deps.check.runSetup).toHaveBeenCalledWith(INSTANCE, ['mkdir /srv/x']);
    expect(h.deps.activity.recordEvent).toHaveBeenCalledWith(USER, 'LAB_STEP_STAGED',
      expect.objectContaining({ stepId: 's2', instanceId: INSTANCE, historyCount: 10 }), expect.anything());
    expect(h.deps.redis.eval).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second stage returns the stored record without rerunning setup', async () => {
    const h = harness();
    h.passStep('s1');
    await h.service.stage(USER, INSTANCE, 's2');
    h.deps.check.runSetup.mockClear();
    const second = await h.service.stage(USER, INSTANCE, 's2');
    expect(second.setupRan).toBe(false);
    expect(h.deps.check.runSetup).not.toHaveBeenCalled();
    expect(h.rows.filter((r) => r.activityType === 'LAB_STEP_STAGED')).toHaveLength(1);
  });

  it('409s STEP_STAGE_IN_PROGRESS when the Redis NX lock is held and 503 when Redis fails', async () => {
    const held = harness();
    held.passStep('s1');
    held.deps.redis.set.mockResolvedValue(null as never);
    await expect(held.service.stage(USER, INSTANCE, 's2')).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'STEP_STAGE_IN_PROGRESS' }] });
    expect(held.deps.check.runSetup).not.toHaveBeenCalled();
    expect(held.deps.redis.eval).not.toHaveBeenCalled();

    const down = harness();
    down.passStep('s1');
    down.deps.redis.set.mockRejectedValue(new Error('redis down') as never);
    await expect(down.service.stage(USER, INSTANCE, 's2')).rejects.toMatchObject({ statusCode: 503, errors: [{ code: 'LAB_ENV_UNREACHABLE' }] });
  });

  it('records nothing and releases the lock when setup fails (503)', async () => {
    const h = harness();
    h.passStep('s1');
    h.deps.check.runSetup.mockRejectedValue(new Error('exec failed') as never);
    await expect(h.service.stage(USER, INSTANCE, 's2')).rejects.toMatchObject({ statusCode: 503 });
    expect(h.rows.some((r) => r.activityType === 'LAB_STEP_STAGED')).toBe(false);
    expect(h.deps.redis.eval).toHaveBeenCalledTimes(1);
  });

  it('refuses locked (STEP_LOCKED) and passed (STEP_ALREADY_PASSED) steps and 404s an unknown step', async () => {
    const h = harness();
    await expect(h.service.stage(USER, INSTANCE, 's2')).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'STEP_LOCKED' }] });
    h.passStep('s1');
    await expect(h.service.stage(USER, INSTANCE, 's1')).rejects.toMatchObject({ errors: [{ code: 'STEP_ALREADY_PASSED' }] });
    await expect(h.service.stage(USER, INSTANCE, 'nope')).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'STEP_NOT_FOUND' }] });
  });

  it('404s an instance the learner does not own and 409s one that is not running', async () => {
    const h = harness();
    h.deps.repo.findInstanceForUser.mockResolvedValue(null as never);
    await expect(h.service.stage(USER, INSTANCE, 's1')).rejects.toMatchObject({ statusCode: 404 });
    h.deps.repo.findInstanceForUser.mockResolvedValue({ instanceId: INSTANCE, labId: LAB, status: 'stopped' } as never);
    await expect(h.service.stage(USER, INSTANCE, 's1')).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'INSTANCE_NOT_RUNNING' }] });
  });
});

describe('LabStepService.check (task steps)', () => {
  it('passes a task once: awards scalePoints(points, multiplier) a single time', async () => {
    const h = harness({ multiplier: 2 });
    const first = await h.service.check(USER, INSTANCE, 's1');
    expect(first).toMatchObject({ passed: true, alreadyPassed: false, pointsAwarded: 50, nextStepId: 's2', labCompleted: false });
    expect(h.award.apply).toHaveBeenCalledTimes(1);
    expect(h.award.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: awardKeys.labStep(LAB, 's1'), points: 50, sourceType: 'lab_complete' }));
    expect(h.deps.gamification.afterLearningEvent).toHaveBeenCalledWith(USER);

    h.award.apply.mockClear();
    const second = await h.service.check(USER, INSTANCE, 's1');
    expect(second).toMatchObject({ passed: true, alreadyPassed: true, pointsAwarded: 0, xp: { delta: 0 } });
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.rows.filter((r) => r.activityType === 'LAB_STEP_PASSED')).toHaveLength(1);
  });

  it('a practice re-check of a passed task step performs no writes at all', async () => {
    const h = harness();
    await h.service.check(USER, INSTANCE, 's1');
    h.deps.repo.insertActivity.mockClear();
    h.award.apply.mockClear();
    h.award.withUserLock.mockClear();
    h.deps.check.evaluate.mockResolvedValue({ passed: false, reason: 'not_passed' } as never);
    const result = await h.service.check(USER, INSTANCE, 's1');
    expect(result).toMatchObject({ alreadyPassed: true, passed: false, reason: 'not_passed', pointsAwarded: 0 });
    expect(h.deps.repo.insertActivity).not.toHaveBeenCalled();
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.award.withUserLock).not.toHaveBeenCalled();
  });

  it('a failed task check records LAB_STEP_FAILED and no penalty', async () => {
    const h = harness();
    h.deps.check.evaluate.mockResolvedValue({ passed: false, reason: 'not_passed' } as never);
    const result = await h.service.check(USER, INSTANCE, 's1');
    expect(result).toMatchObject({ passed: false, reason: 'not_passed', pointsAwarded: 0, penalties: { wrongAnswer: 0, guess: 0 } });
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.rows.some((r) => r.activityType === 'LAB_STEP_FAILED')).toBe(true);
  });

  it('409s STEP_LOCKED for a later step and STEP_NOT_STAGED for a step that needs staging', async () => {
    const h = harness();
    await expect(h.service.check(USER, INSTANCE, 's2')).rejects.toMatchObject({ errors: [{ code: 'STEP_LOCKED' }] });
    h.passStep('s1');
    await expect(h.service.check(USER, INSTANCE, 's2')).rejects.toMatchObject({ errors: [{ code: 'STEP_NOT_STAGED' }] });
    expect(h.deps.check.evaluate).not.toHaveBeenCalled();
  });

  it('an exec failure answers 503 and records nothing', async () => {
    const h = harness();
    h.deps.check.evaluate.mockRejectedValue(new Error('docker exec failed') as never);
    await expect(h.service.check(USER, INSTANCE, 's1')).rejects.toMatchObject({ statusCode: 503, errors: [{ code: 'LAB_ENV_UNREACHABLE' }] });
    expect(h.deps.repo.insertActivity).not.toHaveBeenCalled();
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.award.withUserLock).not.toHaveBeenCalled();
  });

  it('a concurrent pass that wins the race is reported as already passed with nothing written', async () => {
    const h = harness();
    // The unlocked read sees s1 as current; by the time the lock is held another request passed it.
    h.deps.repo.listLabActivity.mockImplementation((async (_u: number, labId: number, types: string[], tx?: unknown) => {
      if (tx) return [{ activityId: 1, activityType: 'LAB_STEP_PASSED', details: { labId, stepId: 's1' }, createdAt: new Date() }];
      return h.rows.filter((r) => types.includes(r.activityType) && r.details.labId === labId);
    }) as never);
    const result = await h.service.check(USER, INSTANCE, 's1');
    expect(result).toMatchObject({ alreadyPassed: true, passed: true, pointsAwarded: 0 });
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.deps.repo.insertActivity).not.toHaveBeenCalled();
  });
});

describe('LabStepService.check (question steps)', () => {
  const ready = () => {
    const h = harness({ steps: [s3] });
    h.stage('s3', 10);
    return h;
  };

  it('422s ANSWER_REQUIRED without an answer and 409s STEP_NOT_STAGED before staging', async () => {
    const h = ready();
    await expect(h.service.check(USER, INSTANCE, 's3')).rejects.toMatchObject({ statusCode: 422, errors: [{ code: 'ANSWER_REQUIRED' }] });
    const unstaged = harness({ steps: [s3] });
    await expect(unstaged.service.check(USER, INSTANCE, 's3', 'nginx')).rejects.toMatchObject({ errors: [{ code: 'STEP_NOT_STAGED' }] });
  });

  it('a wrong answer costs -wrongPenalty with a unique ledger key per failure', async () => {
    const h = ready();
    h.deps.check.readHistoryCount.mockResolvedValue(14 as never); // commands were run: not a guess
    const result = await h.service.check(USER, INSTANCE, 's3', 'apache');
    expect(result).toMatchObject({ passed: false, reason: 'wrong_answer', guessed: false, penalties: { wrongAnswer: 2, guess: 0 }, xp: { delta: -2 } });
    expect(h.award.apply).toHaveBeenCalledTimes(1);
    expect(h.award.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ points: -2, sourceType: 'penalty', key: expect.stringMatching(/^lab_wrong:1:s3:\d+$/) }));
  });

  it('a guessed wrong answer costs both penalties', async () => {
    const h = ready();
    h.deps.check.readHistoryCount.mockResolvedValue(10 as never); // unchanged history: guess
    const result = await h.service.check(USER, INSTANCE, 's3', 'apache');
    expect(result).toMatchObject({ guessed: true, penalties: { wrongAnswer: 2, guess: 5 }, xp: { delta: -7 } });
    expect(h.award.apply).toHaveBeenCalledTimes(2);
  });

  it('a guessed CORRECT answer still passes but pays the guess penalty', async () => {
    const h = ready();
    h.deps.check.readHistoryCount.mockResolvedValue(10 as never);
    const result = await h.service.check(USER, INSTANCE, 's3', '  NGINX ');
    expect(result).toMatchObject({ passed: true, guessed: true, pointsAwarded: 10, penalties: { wrongAnswer: 0, guess: 5 } });
    const calls = h.award.apply.mock.calls.map((c) => (c[1] as { points: number }).points);
    expect(calls).toEqual(expect.arrayContaining([10, -5]));
    expect(h.award.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: expect.stringMatching(/^lab_guess:1:s3:\d+$/) }));
  });

  it('a correct unguessed answer pays points only', async () => {
    const h = ready();
    h.deps.check.readHistoryCount.mockResolvedValue(15 as never);
    const result = await h.service.check(USER, INSTANCE, 's3', 'nginx');
    expect(result).toMatchObject({ passed: true, guessed: false, penalties: { wrongAnswer: 0, guess: 0 } });
  });

  it('a practice re-check of a passed question step evaluates nothing', async () => {
    const h = ready();
    h.deps.check.readHistoryCount.mockResolvedValue(15 as never);
    await h.service.check(USER, INSTANCE, 's3', 'nginx');
    h.deps.check.readHistoryCount.mockClear();
    h.award.apply.mockClear();
    const again = await h.service.check(USER, INSTANCE, 's3', 'wrong');
    expect(again).toMatchObject({ alreadyPassed: true, passed: true, pointsAwarded: 0 });
    expect(h.deps.check.readHistoryCount).not.toHaveBeenCalled();
    expect(h.award.apply).not.toHaveBeenCalled();
  });
});

describe('LabStepService completion', () => {
  it('pays the scaled completion bonus once, completes lab items, records LAB_COMPLETED and shortens the instance', async () => {
    const h = harness({ steps: [s1], multiplier: 2, completionBonus: 50 });
    const result = await h.service.check(USER, INSTANCE, 's1');
    expect(result.labCompleted).toBe(true);
    expect(result.completion).toMatchObject({ completionBonus: 100, completedLessonIds: [201] });
    expect(h.award.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: awardKeys.labDone(LAB), points: 100 }));
    expect(h.deps.progress.completeLabItems).toHaveBeenCalledWith(expect.anything(), USER, LAB);
    expect(h.deps.progress.afterCommit).toHaveBeenCalledWith(USER, [201]);
    expect(h.rows.filter((r) => r.activityType === 'LAB_COMPLETED')).toHaveLength(1);
    expect(h.deps.repo.updateInstanceExpiry).toHaveBeenCalledWith(INSTANCE, expect.any(Date));
    expect(result.xp.delta).toBe(50 + 100);
  });

  it('does not pay the bonus twice when a step is added later and passed after completion', async () => {
    const h = harness({ steps: [s1, task('s9')] });
    h.passStep('s1');
    h.mark('LAB_COMPLETED');
    await h.service.check(USER, INSTANCE, 's9');
    expect(h.award.apply).toHaveBeenCalledTimes(1);
    expect(h.deps.progress.completeLabItems).not.toHaveBeenCalled();
    expect(h.rows.filter((r) => r.activityType === 'LAB_COMPLETED')).toHaveLength(1);
  });

  it('a non-final step does not complete the lab', async () => {
    const h = harness();
    const result = await h.service.check(USER, INSTANCE, 's1');
    expect(result).toMatchObject({ labCompleted: false, completion: null });
    expect(h.deps.progress.completeLabItems).not.toHaveBeenCalled();
    expect(h.deps.repo.updateInstanceExpiry).not.toHaveBeenCalled();
  });
});

describe('LabStepService.revealHint', () => {
  it('reveals hint 0 for -hintCost and records LAB_HINT_REVEALED', async () => {
    const h = harness();
    const result = await h.service.revealHint(USER, LAB, 's1', 0);
    expect(result).toMatchObject({ stepId: 's1', hintIndex: 0, text: 'HINT-ONE', alreadyRevealed: false, penaltyApplied: 5, remaining: 1, xp: { delta: -5 } });
    expect(h.award.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: awardKeys.labHint(LAB, 's1', 'h1'), points: -5, sourceType: 'penalty' }));
    expect(h.deps.activity.recordEvent).toHaveBeenCalledWith(USER, 'LAB_HINT_REVEALED', expect.objectContaining({ hintId: 'h1', penalty: 5 }), expect.anything());
  });

  it('409s HINT_OUT_OF_ORDER when an earlier hint is unrevealed and charges nothing', async () => {
    const h = harness();
    await expect(h.service.revealHint(USER, LAB, 's1', 1)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'HINT_OUT_OF_ORDER' }] });
    expect(h.award.apply).not.toHaveBeenCalled();
  });

  it('a hint that is already revealed returns its text with no penalty and no write', async () => {
    const h = harness();
    await h.service.revealHint(USER, LAB, 's1', 0);
    h.award.apply.mockClear();
    h.deps.activity.recordEvent.mockClear();
    const again = await h.service.revealHint(USER, LAB, 's1', 0);
    expect(again).toMatchObject({ alreadyRevealed: true, penaltyApplied: 0, text: 'HINT-ONE', xp: { delta: 0 } });
    expect(h.award.apply).not.toHaveBeenCalled();
    expect(h.deps.activity.recordEvent).not.toHaveBeenCalled();
  });

  it('404s HINT_NOT_FOUND past the last hint and STEP_NOT_FOUND for an unknown step', async () => {
    const h = harness();
    await expect(h.service.revealHint(USER, LAB, 's1', 3)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'HINT_NOT_FOUND' }] });
    await expect(h.service.revealHint(USER, LAB, 'nope', 0)).rejects.toMatchObject({ errors: [{ code: 'STEP_NOT_FOUND' }] });
  });

  it('409s STEP_LOCKED for a step that is not reachable yet, but allows a passed step', async () => {
    const h = harness({ steps: [s1, s3] });
    await expect(h.service.revealHint(USER, LAB, 's3', 0)).rejects.toMatchObject({ errors: [{ code: 'STEP_LOCKED' }] });
    h.passStep('s1');
    await expect(h.service.revealHint(USER, LAB, 's1', 0)).resolves.toMatchObject({ alreadyRevealed: false });
  });
});
