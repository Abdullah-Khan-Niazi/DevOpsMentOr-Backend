import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizAttemptService, type QuizAttemptServiceDeps } from '../../../src/features/progress/services/QuizAttemptService';
import { QUIZ_LIMITS } from '../../../src/features/progress/config/quiz-limits';
import { orderQuestions } from '../../../src/features/progress/services/quiz-shuffle';
import { awardService } from '../../../src/features/gamification/services/award.service';
import { activityLogService } from '../../../src/features/progress/services/ActivityLogService';
import { progressCompletionHooks } from '../../../src/features/progress/services/progress-completion.hooks';
import { courseAccessService } from '../../../src/features/orgs/services/course-access.service';
import { labService } from '../../../src/features/labs/services/LabService';
import { labCheckService } from '../../../src/features/labs/services/LabCheckService';
import { labsRepository } from '../../../src/features/labs/repositories/labs.repository';
import { gamificationService } from '../../../src/features/gamification/services/gamification.service';
import { redisClient } from '../../../src/app/cache/redis';

/* ── Fake database (table-keyed, scenario driven) ─────────────────────── */

interface Scenario {
  quiz: Record<string, unknown> | null;
  questions: Array<Record<string, unknown>>;
  answerRows: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown> & { attemptId: number; completedAt: Date | null; startedAt: Date; isPassed: boolean }>;
  userAnswers: Array<Record<string, unknown> & { attemptId: number; questionId: number }>;
  staged: Array<{ details: Record<string, unknown>; createdAt: Date }>;
  penaltyRows: Array<{ description: string; pointsChange: number }>;
  labNames: Array<{ labId: number; labName: string }>;
  nextId: number;
  writes: Array<{ op: 'insert' | 'update'; table: string; values: Record<string, unknown> }>;
}

const fake = vi.hoisted(() => ({ s: {} as Scenario, calls: [] as string[] }));

vi.mock('../../../src/app/database', async () => {
  const { getTableName } = await import('drizzle-orm');
  const { MySqlDialect } = await import('drizzle-orm/mysql-core');
  const dialect = new MySqlDialect();
  const nameOf = (table: unknown): string => getTableName(table as never);

  const resolveSelect = (table: string, keys: string[], sqlText: string, params: unknown[]): unknown[] => {
    const s = fake.s;
    switch (table) {
      case 'quizzes':
        return s.quiz ? [s.quiz] : [];
      case 'quiz_questions':
        return s.questions;
      case 'quiz_answers':
        return s.answerRows;
      case 'quiz_attempts': {
        if (keys.length === 0) {
          if (/is null/.test(sqlText) && !/is not null/.test(sqlText)) {
            return s.attempts.filter((a) => a.completedAt === null).slice(-1);
          }
          return s.attempts.filter((a) => params.includes(a.attemptId));
        }
        if (keys.join() === 'startedAt') return s.attempts.map((a) => ({ startedAt: a.startedAt }));
        if (keys.join() === 'value') return [{ value: s.attempts.length }];
        if (keys.includes('score')) {
          return s.attempts.filter((a) => a.completedAt !== null).slice(-1);
        }
        if (keys.join() === 'attemptId') return s.attempts.filter((a) => a.isPassed).slice(0, 1);
        return [];
      }
      case 'user_quiz_answers': {
        if (keys.length === 0) return s.userAnswers.filter((a) => params.includes(a.attemptId));
        return s.userAnswers.filter((a) => params.includes(a.attemptId) && params.includes(a.questionId)).slice(0, 1);
      }
      case 'activity_logs': {
        const wanted = params.length >= 4 ? params[3] : null;
        return s.staged
          .filter((row) => wanted === null || row.details.questionId === wanted)
          .slice(-1 * (wanted === null ? s.staged.length : 1))
          .reverse();
      }
      case 'points_history':
        return keys.join() === 'balance' ? [{ balance: 40 }] : s.penaltyRows;
      case 'labs':
        return s.labNames;
      default:
        return [];
    }
  };

  const selectBuilder = (fields?: Record<string, unknown>) => {
    let table = '';
    let where: unknown;
    const builder = {
      from(target: unknown) { table = nameOf(target); return builder; },
      innerJoin() { return builder; },
      where(condition: unknown) { where = condition; return builder; },
      orderBy() { return builder; },
      limit() { return builder; },
      for() { return builder; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        const query = where ? dialect.sqlToQuery(where as never) : { sql: '', params: [] };
        const rows = resolveSelect(table, fields ? Object.keys(fields) : [], query.sql, query.params);
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  };

  const tx = {
    select: (fields?: Record<string, unknown>) => selectBuilder(fields),
    insert: (target: unknown) => {
      let values: Record<string, unknown> = {};
      const builder = {
        values(v: Record<string, unknown>) { values = v; return builder; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const table = nameOf(target);
          const id = fake.s.nextId++;
          fake.s.writes.push({ op: 'insert', table, values });
          if (table === 'quiz_attempts') fake.s.attempts.push({ attemptId: id, ...values });
          if (table === 'user_quiz_answers') fake.s.userAnswers.push({ userAnswerId: id, ...values });
          return Promise.resolve([{ insertId: id }]).then(resolve, reject);
        },
      };
      return builder;
    },
    update: (target: unknown) => {
      let values: Record<string, unknown> = {};
      const builder = {
        set(v: Record<string, unknown>) { values = v; return builder; },
        where() { return builder; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const table = nameOf(target);
          fake.s.writes.push({ op: 'update', table, values });
          if (table === 'quiz_attempts') {
            const open = fake.s.attempts.find((a) => a.completedAt === null || a.attemptId === fake.s.attempts[0]?.attemptId);
            const row = fake.s.attempts.find((a) => a.completedAt === null) ?? open;
            if (row) Object.assign(row, values);
          }
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { db: tx };
});

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: { get: vi.fn(), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) },
  cacheKeys: {},
}));
vi.mock('../../../src/features/gamification/services/award.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/features/gamification/services/award.service')>();
  return {
    ...actual,
    awardService: {
      withUserLock: vi.fn(),
      apply: vi.fn(),
      balance: vi.fn(),
    },
  };
});
vi.mock('../../../src/features/gamification/services/gamification.service', () => ({
  gamificationService: { afterLearningEvent: vi.fn(async () => undefined) },
}));
vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: { recordEvent: vi.fn(async () => undefined), getActivityHistory: vi.fn(async () => []) },
}));
vi.mock('../../../src/features/progress/services/progress-completion.hooks', () => ({
  progressCompletionHooks: {
    completeQuizItems: vi.fn(async () => [201]),
    completeLabItems: vi.fn(async () => []),
    afterCommit: vi.fn(async () => undefined),
  },
}));
vi.mock('../../../src/features/orgs/services/course-access.service', () => ({
  courseAccessService: { getCourseAccess: vi.fn() },
}));
vi.mock('../../../src/features/labs/services/LabService', () => ({
  labService: { getActiveInstance: vi.fn(), provisionInstance: vi.fn() },
}));
vi.mock('../../../src/features/labs/services/LabCheckService', () => ({
  labCheckService: { runSetup: vi.fn(), readHistoryCount: vi.fn(), evaluate: vi.fn() },
}));
vi.mock('../../../src/features/labs/repositories/labs.repository', () => ({
  labsRepository: { findInstanceForUser: vi.fn() },
}));
vi.mock('../../../src/features/curriculum/services/CurriculumService', () => ({
  curriculumService: { getQuizById: vi.fn() },
}));

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const USER = 9;
const ATTEMPT = 100;
const NOW = Date.now();

const quizMeta = (overrides: Record<string, unknown> = {}) => ({
  quizId: 30, moduleId: 10, courseId: 1, title: 'Linux quiz', description: null, passingScore: 60, timeLimitMinutes: null,
  ...overrides,
});

const q = (questionId: number, questionType: string, points: number, config: unknown, extra: Record<string, unknown> = {}) => ({
  questionId, questionText: `Question ${questionId}`, questionType, points, explanation: `EXPLAIN-${questionId}`,
  questionOrder: questionId, config, ...extra,
});

const answer = (questionId: number, answerId: number, answerText: string, isCorrect: boolean, answerOrder = 1) => ({
  questionId, answerId, answerText, isCorrect, answerOrder,
});

const terminalAnswerConfig = {
  wrongPenalty: 2, guessPenalty: 5, instructions: 'Find it.',
  terminal: { labId: 3, mode: 'answer', answerFormat: 'text', setup: ['echo SETUPSECRET'] },
};
const terminalCheckConfig = {
  wrongPenalty: 3, guessPenalty: 0,
  terminal: { labId: 3, mode: 'check', answerFormat: null, setup: [], check: { type: 'command', command: 'echo CHECKSECRET', expect: { mode: 'exitCode', value: 0 } } },
};

function baseQuestions() {
  return [
    q(11, 'multiple_choice', 10, { wrongPenalty: 2, guessPenalty: 0 }),
    q(12, 'fill_blank', 10, { wrongPenalty: 0, guessPenalty: 0 }),
    q(13, 'terminal', 20, terminalAnswerConfig),
    q(14, 'terminal', 20, terminalCheckConfig),
    q(15, 'multiple_choice', 10, null), // config missing: penalties read as 0
  ];
}

function baseAnswers() {
  return [
    answer(11, 111, 'Right', true, 1), answer(11, 112, 'Wrong', false, 2),
    answer(12, 121, 'ACCEPTED-TEXT', true, 1),
    answer(13, 131, 'ANSWERSECRET', true, 1),
    answer(15, 151, 'Yes', true, 1), answer(15, 152, 'No', false, 2),
  ];
}

const openAttempt = (overrides: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT, userId: USER, quizId: 30, score: 0, isPassed: false, attemptNumber: 1,
  startedAt: new Date(NOW - 60_000), completedAt: null, timeTakenSeconds: null, ...overrides,
});

const instance = (overrides: Record<string, unknown> = {}) => ({
  instanceId: 77, labId: 3, status: 'running', terminalWsUrl: 'wss://t/77', expiresAt: '2030-01-01T00:00:00.000Z', ...overrides,
});

function makeRepo() {
  return {
    hasPassedQuizAttempt: vi.fn(async () => false),
    quizAttemptStats: vi.fn(async () => new Map()),
    listQuizAttemptsByQuiz: vi.fn(async () => []),
  };
}

function makeService(repo = makeRepo()) {
  return { service: new QuizAttemptService({ repo } as unknown as QuizAttemptServiceDeps), repo };
}

const deepKeys = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); deepKeys(v, out); }
  }
  return out;
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.calls = [];
  fake.s = {
    quiz: quizMeta(), questions: baseQuestions(), answerRows: baseAnswers(), attempts: [], userAnswers: [], staged: [],
    penaltyRows: [], labNames: [{ labId: 3, labName: 'Linux Lab' }], nextId: 500, writes: [],
  };
  vi.mocked(awardService.withUserLock).mockImplementation((async (_u: number, fn: (tx: unknown) => unknown) => {
    fake.calls.push('lock');
    const { db } = await import('../../../src/app/database');
    return fn(db);
  }) as never);
  vi.mocked(awardService.apply).mockImplementation((async (_tx: unknown, input: { points: number }) => ({
    applied: true, historyId: 1, pointsChange: input.points, balance: 100,
  })) as never);
  vi.mocked(awardService.balance).mockResolvedValue(100 as never);
  vi.mocked(courseAccessService.getCourseAccess).mockResolvedValue({ canAccess: true, reason: 'free', message: null } as never);
  vi.mocked(labService.getActiveInstance).mockResolvedValue(null as never);
  vi.mocked(labService.provisionInstance).mockImplementation((async () => { fake.calls.push('provision'); return instance(); }) as never);
  vi.mocked(labCheckService.runSetup).mockResolvedValue(undefined as never);
  vi.mocked(labCheckService.readHistoryCount).mockResolvedValue(10 as never);
  vi.mocked(labsRepository.findInstanceForUser).mockResolvedValue({ instanceId: 77, labId: 3, status: 'running' } as never);
  vi.mocked(redisClient.set).mockResolvedValue('OK' as never);
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe('QuizAttemptService.start', () => {
  it('creates attempt 1 under the user lock and records QUIZ_STARTED', async () => {
    const { service } = makeService();
    const { attempt, resumed } = await service.start(USER, 30);
    expect(resumed).toBe(false);
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.totalQuestions).toBe(5);
    expect(attempt.totalPoints).toBe(70);
    expect(fake.s.writes.filter((w) => w.table === 'quiz_attempts' && w.op === 'insert')).toHaveLength(1);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(USER, 'QUIZ_STARTED', expect.objectContaining({ quizId: 30 }), expect.anything());
    expect(awardService.withUserLock).toHaveBeenCalledTimes(1);
  });

  it('resumes the open attempt without inserting a second one', async () => {
    fake.s.attempts = [openAttempt()];
    const { service } = makeService();
    const { attempt, resumed } = await service.start(USER, 30);
    expect(resumed).toBe(true);
    expect(attempt.attemptId).toBe(ATTEMPT);
    expect(fake.s.writes.filter((w) => w.op === 'insert')).toHaveLength(0);
  });

  it('enforces the daily cap with 429 QUIZ_ATTEMPT_LIMIT and retryAfterSeconds', async () => {
    const hourAgo = new Date(NOW - 3_600_000);
    fake.s.attempts = Array.from({ length: QUIZ_LIMITS.maxAttemptsPerDay }, (_, i) => openAttempt({
      attemptId: 90 + i, startedAt: hourAgo, completedAt: new Date(NOW - 3_000_000), isPassed: false, score: 10,
    }));
    const { service } = makeService();
    const error = await service.start(USER, 30).catch((e: unknown) => e) as { statusCode: number; errors: Array<Record<string, unknown>> };
    expect(error.statusCode).toBe(429);
    expect(error.errors[0]).toMatchObject({ code: 'QUIZ_ATTEMPT_LIMIT' });
    expect(error.errors[0].retryAfterSeconds).toBeGreaterThan(0);
    expect(fake.s.writes.filter((w) => w.op === 'insert')).toHaveLength(0);
  });

  it('enforces the retry cooldown after a failed attempt with retryAfterSeconds', async () => {
    fake.s.attempts = [openAttempt({ attemptId: 90, startedAt: new Date(NOW - 50_000), completedAt: new Date(NOW - 10_000), score: 10 })];
    const { service } = makeService();
    const error = await service.start(USER, 30).catch((e: unknown) => e) as { statusCode: number; errors: Array<Record<string, unknown>> };
    expect(error.statusCode).toBe(429);
    expect(error.errors[0]).toMatchObject({ code: 'QUIZ_COOLDOWN' });
    const retry = error.errors[0].retryAfterSeconds as number;
    expect(retry).toBeGreaterThan(QUIZ_LIMITS.retryCooldownSeconds - 15);
    expect(retry).toBeLessThanOrEqual(QUIZ_LIMITS.retryCooldownSeconds);
  });

  it('allows a new attempt once the cooldown has elapsed', async () => {
    fake.s.attempts = [openAttempt({ attemptId: 90, startedAt: new Date(NOW - 600_000), completedAt: new Date(NOW - 300_000), score: 10 })];
    const { service } = makeService();
    const { attempt } = await service.start(USER, 30);
    expect(attempt.attemptNumber).toBe(2);
  });

  it('409s QUIZ_ALREADY_PASSED, QUIZ_EMPTY and maps access and visibility failures', async () => {
    const passed = makeService();
    passed.repo.hasPassedQuizAttempt.mockResolvedValue(true);
    await expect(passed.service.start(USER, 30)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'QUIZ_ALREADY_PASSED' }] });

    fake.s.questions = [];
    await expect(makeService().service.start(USER, 30)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'QUIZ_EMPTY' }] });

    fake.s.questions = baseQuestions();
    vi.mocked(courseAccessService.getCourseAccess).mockResolvedValue({ canAccess: false, reason: 'premium_required', message: 'Upgrade.' } as never);
    await expect(makeService().service.start(USER, 30)).rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'COURSE_ACCESS_DENIED', reason: 'premium_required' }] });

    vi.mocked(courseAccessService.getCourseAccess).mockResolvedValue({ canAccess: true } as never);
    fake.s.quiz = null;
    await expect(makeService().service.start(USER, 30)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('finalizes an expired open attempt lazily and then starts a new one', async () => {
    fake.s.quiz = quizMeta({ timeLimitMinutes: 5 });
    fake.s.attempts = [openAttempt({ startedAt: new Date(NOW - 3_600_000) })];
    const { service } = makeService();
    // The expired attempt fails (no answers), so the cooldown from its completion blocks the new start.
    await expect(service.start(USER, 30)).rejects.toMatchObject({ statusCode: 429 });
    const finalize = fake.s.writes.find((w) => w.op === 'update' && w.table === 'quiz_attempts');
    expect(finalize?.values).toMatchObject({ score: 0, isPassed: false });
    expect(finalize?.values.completedAt).toBeInstanceOf(Date);
    // time taken is capped at the deadline (5 minutes), not the 1 hour elapsed
    expect(finalize?.values.timeTakenSeconds).toBe(300);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(USER, 'QUIZ_FAILED', expect.anything(), expect.anything());
  });
});

describe('learner DTO', () => {
  it('uses a deterministic shuffle: a resumed attempt renders the same order', async () => {
    const { service } = makeService();
    const first = await service.start(USER, 30);
    fake.s.attempts = [openAttempt({ attemptId: first.attempt.attemptId })];
    const second = await service.start(USER, 30);
    expect(second.attempt.questions.map((x) => x.questionId)).toEqual(first.attempt.questions.map((x) => x.questionId));
    expect(second.attempt.questions.map((x) => x.options.map((o) => o.answerId)))
      .toEqual(first.attempt.questions.map((x) => x.options.map((o) => o.answerId)));
    expect(first.attempt.questions.map((x) => x.questionId))
      .toEqual(orderQuestions(first.attempt.attemptId, [11, 12, 13, 14, 15]));
    expect(first.attempt.questions.map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exposes correctness, answer order, accepted texts, terminal setup/check or explanations', async () => {
    const { service } = makeService();
    const { attempt } = await service.start(USER, 30);
    const json = JSON.stringify(attempt);
    for (const secret of ['isCorrect', 'answerOrder', 'ACCEPTED-TEXT', 'ANSWERSECRET', 'SETUPSECRET', 'CHECKSECRET', 'EXPLAIN-', 'setup', '"check":']) {
      expect(json).not.toContain(secret);
    }
    const keys = deepKeys(attempt);
    expect(keys.has('isCorrect')).toBe(false);
    expect(keys.has('config')).toBe(false);
  });

  it('hides option lists for fill_blank and terminal text/check questions and reports penalties per question', async () => {
    const { service } = makeService();
    const { attempt } = await service.start(USER, 30);
    const byId = new Map(attempt.questions.map((x) => [x.questionId, x]));
    expect(byId.get(12)?.options).toEqual([]);
    expect(byId.get(13)?.options).toEqual([]);
    expect(byId.get(14)?.options).toEqual([]);
    expect(byId.get(11)?.options).toHaveLength(2);
    expect(byId.get(13)?.penalties).toEqual({ wrongAnswer: 2, guess: 5 });
    expect(byId.get(14)?.penalties).toEqual({ wrongAnswer: 3, guess: 0 });
    expect(byId.get(15)?.penalties).toEqual({ wrongAnswer: 0, guess: 0 });
    expect(byId.get(13)?.terminal).toMatchObject({ labId: 3, labName: 'Linux Lab', mode: 'answer', answerFormat: 'text', staged: null });
  });

  it('populates terminal.staged once the question has been staged', async () => {
    fake.s.attempts = [openAttempt()];
    fake.s.staged = [{ details: { attemptId: ATTEMPT, questionId: 13, instanceId: 77, historyCount: 10 }, createdAt: new Date('2026-02-01T10:00:00Z') }];
    const { service } = makeService();
    const { attempt } = await service.getAttempt(USER, ATTEMPT);
    const terminal = attempt.questions.find((x) => x.questionId === 13)?.terminal;
    expect(terminal?.staged).toEqual({ instanceId: 77, stagedAt: '2026-02-01T10:00:00.000Z' });
  });
});

describe('QuizAttemptService.submitAnswer', () => {
  beforeEach(() => {
    fake.s.attempts = [openAttempt()];
  });

  it('grades a correct choice, stores it and applies no penalty', async () => {
    const { service } = makeService();
    const result = await service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'choice', answerId: 111 } });
    expect(result).toMatchObject({ questionId: 11, isCorrect: true, pointsEarned: 10, guessed: false });
    expect(awardService.apply).not.toHaveBeenCalled();
    const stored = fake.s.writes.find((w) => w.table === 'user_quiz_answers');
    expect(stored?.values).toMatchObject({ attemptId: ATTEMPT, questionId: 11, answerId: 111, isCorrect: true, pointsEarned: 10 });
  });

  it('applies the configured wrong penalty once, as a negative ledger row', async () => {
    const { service } = makeService();
    const result = await service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'choice', answerId: 112 } });
    expect(result).toMatchObject({ isCorrect: false, pointsEarned: 0, penalties: { wrongAnswer: 2, guess: 0 } });
    expect(result.xp.delta).toBe(-2);
    expect(awardService.apply).toHaveBeenCalledTimes(1);
    expect(awardService.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: USER, points: -2, sourceType: 'penalty', key: expect.stringContaining(`quiz_wrong:${ATTEMPT}:11`),
    }));
  });

  it('treats a missing config as zero penalties (no ledger write on a wrong answer)', async () => {
    const { service } = makeService();
    const result = await service.submitAnswer(USER, ATTEMPT, { questionId: 15, response: { type: 'choice', answerId: 152 } });
    expect(result).toMatchObject({ isCorrect: false, penalties: { wrongAnswer: 0, guess: 0 } });
    expect(awardService.apply).not.toHaveBeenCalled();
  });

  it('grades fill_blank case-insensitively', async () => {
    const { service } = makeService();
    const result = await service.submitAnswer(USER, ATTEMPT, { questionId: 12, response: { type: 'text', text: '  accepted-TEXT ' } });
    expect(result.isCorrect).toBe(true);
  });

  it('409s QUESTION_ALREADY_ANSWERED on a double submit and writes nothing', async () => {
    fake.s.userAnswers = [{ userAnswerId: 1, attemptId: ATTEMPT, questionId: 11, isCorrect: true, pointsEarned: 10 }];
    const { service } = makeService();
    await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'choice', answerId: 111 } }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'QUESTION_ALREADY_ANSWERED' }] });
    expect(fake.s.writes.filter((w) => w.table === 'user_quiz_answers')).toHaveLength(0);
    expect(awardService.apply).not.toHaveBeenCalled();
  });

  it('rejects a question outside the attempt, a wrong response shape and a closed attempt', async () => {
    const { service } = makeService();
    await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 999, response: { type: 'choice', answerId: 1 } }))
      .rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'QUESTION_NOT_IN_ATTEMPT' }] });
    await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'text', text: 'x' } }))
      .rejects.toMatchObject({ statusCode: 422 });
    fake.s.attempts = [openAttempt({ completedAt: new Date() })];
    await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'choice', answerId: 111 } }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'ATTEMPT_CLOSED' }] });
  });

  it('404s an attempt owned by someone else', async () => {
    fake.s.attempts = [];
    const { service } = makeService();
    await expect(service.submitAnswer(USER, 12345, { questionId: 11, response: { type: 'choice', answerId: 111 } }))
      .rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'ATTEMPT_NOT_FOUND' }] });
  });

  it('refuses an answer after the deadline with QUIZ_TIME_EXPIRED and finalizes the attempt', async () => {
    fake.s.quiz = quizMeta({ timeLimitMinutes: 5 });
    fake.s.attempts = [openAttempt({ startedAt: new Date(NOW - 3_600_000) })];
    const { service } = makeService();
    await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 11, response: { type: 'choice', answerId: 111 } }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'QUIZ_TIME_EXPIRED' }] });
    expect(fake.s.writes.some((w) => w.op === 'update' && w.table === 'quiz_attempts')).toBe(true);
    expect(fake.s.writes.filter((w) => w.table === 'user_quiz_answers')).toHaveLength(0);
  });

  describe('terminal questions', () => {
    const staged = { details: { attemptId: ATTEMPT, questionId: 13, instanceId: 77, historyCount: 10 }, createdAt: new Date() };

    it('409s TERMINAL_NOT_STAGED when the question was never staged', async () => {
      const { service } = makeService();
      await expect(service.submitAnswer(USER, ATTEMPT, { questionId: 13, response: { type: 'text', text: 'ANSWERSECRET' } }))
        .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'TERMINAL_NOT_STAGED' }] });
    });

    it('records a guess when the shell history did not grow, even for a correct answer (-guessPenalty)', async () => {
      fake.s.staged = [staged];
      vi.mocked(labCheckService.readHistoryCount).mockResolvedValue(10 as never);
      const { service } = makeService();
      const result = await service.submitAnswer(USER, ATTEMPT, { questionId: 13, response: { type: 'text', text: 'ANSWERSECRET' } });
      expect(result).toMatchObject({ isCorrect: true, guessed: true, pointsEarned: 20, penalties: { wrongAnswer: 2, guess: 5 } });
      expect(awardService.apply).toHaveBeenCalledTimes(1);
      expect(awardService.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        points: -5, key: expect.stringContaining(`quiz_guess:${ATTEMPT}:13`),
      }));
    });

    it('applies both penalties once for a wrong guessed answer and none when commands were run', async () => {
      fake.s.staged = [staged];
      vi.mocked(labCheckService.readHistoryCount).mockResolvedValue(10 as never);
      const guessedWrong = await makeService().service.submitAnswer(USER, ATTEMPT, { questionId: 13, response: { type: 'text', text: 'nope' } });
      expect(guessedWrong.xp.delta).toBe(-7);
      expect(awardService.apply).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();
      vi.mocked(awardService.withUserLock).mockImplementation((async (_u: number, fn: (tx: unknown) => unknown) => fn((await import('../../../src/app/database')).db)) as never);
      vi.mocked(awardService.apply).mockImplementation((async (_t: unknown, i: { points: number }) => ({ applied: true, historyId: 1, pointsChange: i.points, balance: 1 })) as never);
      vi.mocked(awardService.balance).mockResolvedValue(1 as never);
      vi.mocked(courseAccessService.getCourseAccess).mockResolvedValue({ canAccess: true } as never);
      vi.mocked(labsRepository.findInstanceForUser).mockResolvedValue({ instanceId: 77, labId: 3, status: 'running' } as never);
      fake.s.userAnswers = [];
      vi.mocked(labCheckService.readHistoryCount).mockResolvedValue(14 as never);
      const worked = await makeService().service.submitAnswer(USER, ATTEMPT, { questionId: 13, response: { type: 'text', text: 'ANSWERSECRET' } });
      expect(worked).toMatchObject({ isCorrect: true, guessed: false });
      expect(awardService.apply).not.toHaveBeenCalled();
    });

    it('grades a check question through the lab check outside the lock and charges only the wrong penalty', async () => {
      fake.s.staged = [{ details: { attemptId: ATTEMPT, questionId: 14, instanceId: 77, historyCount: 3 }, createdAt: new Date() }];
      vi.mocked(labCheckService.evaluate).mockImplementation((async () => { fake.calls.push('evaluate'); return { passed: false }; }) as never);
      const result = await makeService().service.submitAnswer(USER, ATTEMPT, { questionId: 14, response: { type: 'terminal_check' } });
      expect(result).toMatchObject({ isCorrect: false, guessed: false, pointsEarned: 0 });
      expect(awardService.apply).toHaveBeenCalledTimes(1);
      expect(awardService.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ points: -3 }));
      expect(fake.calls.indexOf('evaluate')).toBeLessThan(fake.calls.indexOf('lock'));
    });

    it('409s TERMINAL_NOT_STAGED when the staged instance is no longer running', async () => {
      fake.s.staged = [staged];
      vi.mocked(labsRepository.findInstanceForUser).mockResolvedValue({ instanceId: 77, labId: 3, status: 'terminated' } as never);
      await expect(makeService().service.submitAnswer(USER, ATTEMPT, { questionId: 13, response: { type: 'text', text: 'x' } }))
        .rejects.toMatchObject({ errors: [{ code: 'TERMINAL_NOT_STAGED' }] });
    });
  });
});

describe('QuizAttemptService.complete', () => {
  const answered = (questionId: number, pointsEarned: number, isCorrect = true) => ({
    userAnswerId: questionId, attemptId: ATTEMPT, questionId, answerId: null, answerText: '{}', isCorrect, pointsEarned, answeredAt: new Date(),
  });

  it('awards sum(points_earned) once on the first pass and completes the linked quiz items', async () => {
    fake.s.quiz = quizMeta({ passingScore: 40 });
    fake.s.attempts = [openAttempt()];
    fake.s.userAnswers = [answered(11, 10), answered(12, 10), answered(15, 10)];
    const { service } = makeService();
    const result = await service.complete(USER, ATTEMPT);

    expect(result).toMatchObject({ isPassed: true, score: 43, firstPass: true, xpAwarded: 30, completedLessonIds: [201] });
    expect(awardService.apply).toHaveBeenCalledTimes(1);
    expect(awardService.apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      points: 30, key: expect.stringContaining('quiz_pass'), sourceType: 'course_complete',
    }));
    expect(progressCompletionHooks.completeQuizItems).toHaveBeenCalledWith(expect.anything(), USER, 30);
    expect(progressCompletionHooks.afterCommit).toHaveBeenCalledWith(USER, [201]);
    expect(gamificationService.afterLearningEvent).toHaveBeenCalledWith(USER);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(USER, 'QUIZ_PASSED', expect.anything(), expect.anything());
  });

  it('fails below the passing score (QUIZ_FAILED, no award, no item completion)', async () => {
    fake.s.quiz = quizMeta({ passingScore: 90 });
    fake.s.attempts = [openAttempt()];
    fake.s.userAnswers = [answered(11, 10)];
    const result = await makeService().service.complete(USER, ATTEMPT);
    expect(result).toMatchObject({ isPassed: false, firstPass: false, xpAwarded: 0 });
    expect(awardService.apply).not.toHaveBeenCalled();
    expect(progressCompletionHooks.completeQuizItems).not.toHaveBeenCalled();
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(USER, 'QUIZ_FAILED', expect.anything(), expect.anything());
  });

  it('awards nothing on a later pass (the quiz was already passed) but still records the attempt', async () => {
    fake.s.quiz = quizMeta({ passingScore: 40 });
    fake.s.attempts = [openAttempt()];
    fake.s.userAnswers = [answered(11, 10), answered(12, 10), answered(15, 10)];
    const repo = makeRepo();
    repo.hasPassedQuizAttempt.mockResolvedValue(true);
    const result = await makeService(repo).service.complete(USER, ATTEMPT);
    expect(result).toMatchObject({ isPassed: true, firstPass: false, xpAwarded: 0 });
    expect(awardService.apply).not.toHaveBeenCalled();
    expect(progressCompletionHooks.completeQuizItems).not.toHaveBeenCalled();
  });

  it('counts unanswered questions as zero with no penalty', async () => {
    fake.s.attempts = [openAttempt()];
    const result = await makeService().service.complete(USER, ATTEMPT);
    expect(result).toMatchObject({ score: 0, isPassed: false, answeredCount: 0, totalQuestions: 5 });
    expect(awardService.apply).not.toHaveBeenCalled();
  });

  it('409s ATTEMPT_CLOSED when completing twice and awards nothing the second time', async () => {
    fake.s.attempts = [openAttempt({ completedAt: new Date(NOW - 1000), isPassed: true, score: 80 })];
    await expect(makeService().service.complete(USER, ATTEMPT)).rejects.toMatchObject({ errors: [{ code: 'ATTEMPT_CLOSED' }] });
    expect(awardService.apply).not.toHaveBeenCalled();
  });
});

describe('QuizAttemptService.getReview', () => {
  it('409s QUIZ_NOT_PASSED until the quiz is passed', async () => {
    fake.s.attempts = [openAttempt({ completedAt: new Date(), score: 10 })];
    await expect(makeService().service.getReview(USER, ATTEMPT)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'QUIZ_NOT_PASSED' }] });
  });

  it('returns correct answers and explanations once passed', async () => {
    fake.s.attempts = [openAttempt({ completedAt: new Date(), score: 80, isPassed: true })];
    const repo = makeRepo();
    repo.hasPassedQuizAttempt.mockResolvedValue(true);
    const review = await makeService(repo).service.getReview(USER, ATTEMPT);
    const byId = new Map(review.questions.map((x) => [x.questionId, x]));
    expect(byId.get(11)?.correct).toEqual({ answerIds: [111] });
    expect(byId.get(12)?.correct).toEqual({ text: 'ACCEPTED-TEXT' });
    expect(byId.get(14)?.correct).toBeNull();
    expect(byId.get(11)?.explanation).toBe('EXPLAIN-11');
  });
});

describe('QuizAttemptService.stageTerminal', () => {
  beforeEach(() => {
    fake.s.attempts = [openAttempt()];
  });

  it('provisions OUTSIDE the user lock, runs setup, and records the history count under the lock', async () => {
    const { service } = makeService();
    const stage = await service.stageTerminal(USER, ATTEMPT, 13, 'EU');
    expect(labService.provisionInstance).toHaveBeenCalledWith(USER, 3, 'EU');
    expect(fake.calls.indexOf('provision')).toBeLessThan(fake.calls.indexOf('lock'));
    expect(labCheckService.runSetup).toHaveBeenCalledWith(77, ['echo SETUPSECRET']);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(
      USER, 'QUIZ_TERMINAL_STAGED',
      expect.objectContaining({ attemptId: ATTEMPT, questionId: 13, instanceId: 77, historyCount: 10 }),
      expect.anything(),
    );
    expect(stage).toMatchObject({ attemptId: ATTEMPT, questionId: 13, instanceId: 77, provisioned: true, terminalWsUrl: 'wss://t/77' });
    expect(redisClient.del).toHaveBeenCalled();
    expect(JSON.stringify(stage)).not.toContain('SETUPSECRET');
  });

  it('reuses the running instance of the same lab without provisioning', async () => {
    vi.mocked(labService.getActiveInstance).mockResolvedValue(instance() as never);
    const stage = await makeService().service.stageTerminal(USER, ATTEMPT, 13);
    expect(labService.provisionInstance).not.toHaveBeenCalled();
    expect(stage.provisioned).toBe(false);
    expect(stage.instanceId).toBe(77);
  });

  it('is idempotent on the same running instance: the second stage reruns no setup', async () => {
    vi.mocked(labService.getActiveInstance).mockResolvedValue(instance() as never);
    fake.s.staged = [{ details: { attemptId: ATTEMPT, questionId: 13, instanceId: 77, historyCount: 10 }, createdAt: new Date('2026-02-01T10:00:00Z') }];
    const stage = await makeService().service.stageTerminal(USER, ATTEMPT, 13);
    expect(labCheckService.runSetup).not.toHaveBeenCalled();
    expect(stage.stagedAt).toBe('2026-02-01T10:00:00.000Z');
  });

  it('409s INSTANCE_ALREADY_ACTIVE when the learner runs a different lab or a non-running instance', async () => {
    vi.mocked(labService.getActiveInstance).mockResolvedValue(instance({ labId: 9 }) as never);
    await expect(makeService().service.stageTerminal(USER, ATTEMPT, 13)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'INSTANCE_ALREADY_ACTIVE' }] });
    vi.mocked(labService.getActiveInstance).mockResolvedValue(instance({ status: 'stopped' }) as never);
    await expect(makeService().service.stageTerminal(USER, ATTEMPT, 13)).rejects.toMatchObject({ errors: [{ code: 'INSTANCE_ALREADY_ACTIVE' }] });
    expect(labService.provisionInstance).not.toHaveBeenCalled();
  });

  it('409s STEP_STAGE_IN_PROGRESS when the Redis mutex is held, and 404s a non-terminal question', async () => {
    vi.mocked(redisClient.set).mockResolvedValue(null as never);
    await expect(makeService().service.stageTerminal(USER, ATTEMPT, 13)).rejects.toMatchObject({ errors: [{ code: 'STEP_STAGE_IN_PROGRESS' }] });
    vi.mocked(redisClient.set).mockResolvedValue('OK' as never);
    await expect(makeService().service.stageTerminal(USER, ATTEMPT, 11)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'QUESTION_NOT_IN_ATTEMPT' }] });
  });

  it('refuses to stage a question that was already answered', async () => {
    fake.s.userAnswers = [{ userAnswerId: 1, attemptId: ATTEMPT, questionId: 13, isCorrect: true, pointsEarned: 20 }];
    await expect(makeService().service.stageTerminal(USER, ATTEMPT, 13)).rejects.toMatchObject({ errors: [{ code: 'QUESTION_ALREADY_ANSWERED' }] });
    expect(labService.provisionInstance).not.toHaveBeenCalled();
  });
});

describe('QuizAttemptService.getAttemptHistory', () => {
  it('maps the stored attempts for the learner', async () => {
    const { curriculumService } = await import('../../../src/features/curriculum/services/CurriculumService');
    vi.mocked(curriculumService.getQuizById).mockResolvedValue({ quizId: 30 } as never);
    const repo = makeRepo();
    repo.listQuizAttemptsByQuiz.mockResolvedValue([{
      attemptId: 1, score: 80, isPassed: true, attemptNumber: 1, startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:10:00Z'), timeTakenSeconds: 600,
    }] as never);
    const history = await makeService(repo).service.getAttemptHistory(USER, 30);
    expect(history).toEqual([expect.objectContaining({ attemptId: 1, quizId: 30, score: 80, timeTakenSeconds: 600 })]);
    vi.mocked(curriculumService.getQuizById).mockResolvedValue(null as never);
    await expect(makeService().service.getAttemptHistory(USER, 31)).rejects.toMatchObject({ statusCode: 404 });
  });
});
