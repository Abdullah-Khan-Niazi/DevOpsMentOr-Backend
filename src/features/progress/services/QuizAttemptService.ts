import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { redisClient } from '../../../app/cache/redis';
import { db } from '../../../app/database';
import {
  academyCourses,
  activityLogs,
  labs,
  modules,
  pointsHistory,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  userQuizAnswers,
} from '../../../app/database/schema';
import { HTTP_STATUS } from '../../../shared/constants';
import { AppError, ConflictError, ERROR_CODES, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { escapeLike } from '../../gamification/config/award-keys';
import { awardKeys, awardService, type Tx } from '../../gamification/services/award.service';
import { gamificationService } from '../../gamification/services/gamification.service';
import type { LabStepCheck } from '../../labs/dto/lab-spec.dto';
import type { VpnRegion, XpDeltaDto } from '../../labs/dto/labs.dto';
import { labsRepository } from '../../labs/repositories/labs.repository';
import { labCheckService } from '../../labs/services/LabCheckService';
import { labService } from '../../labs/services/LabService';
import { courseAccessService } from '../../orgs/services/course-access.service';
import { QUIZ_LIMITS } from '../config/quiz-limits';
import type {
  LearnerQuizQuestionDto,
  QuizAnswerResponse,
  QuizAnswerResultDto,
  QuizAttemptDto,
  QuizAttemptResultDto,
  QuizAttemptStartDto,
  QuizQuestionType,
  QuizReviewDto,
  QuizStatusDto,
  TerminalStageDto,
} from '../dto/progress.dto';
import type { ProgressExecutor, ProgressRepository } from '../repositories/progress.repository';
import { progressRepository } from '../repositories/progress.repository';
import { activityLogService } from './ActivityLogService';
import { progressCompletionHooks } from './progress-completion.hooks';
import { assertResponseShape, gradeResponse } from './quiz-grading';
import { orderOptions, orderQuestions } from './quiz-shuffle';
import { curriculumService } from '../../curriculum/services/CurriculumService';

/** Body of POST /progress/quiz-attempts/:attemptId/answers (validated by submitQuizAnswerSchema). */
export interface SubmitQuizAnswerBody {
  questionId: number;
  response: QuizAnswerResponse;
}

export interface QuizAttemptServiceDeps {
  repo: ProgressRepository;
}

function defaultDeps(): QuizAttemptServiceDeps {
  return { repo: progressRepository };
}

/** Query-capable handle: the global `db` or the transaction that holds the user lock. */
type Exec = ProgressExecutor;

type AttemptRow = typeof quizAttempts.$inferSelect;
type AnswerRecord = typeof userQuizAnswers.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Redis mutex TTL for one terminal stage request (contracts 4.4). */
const STAGE_MUTEX_TTL_MS = 90_000;

/* ── Internal shapes ─────────────────────────────────────────────────── */

interface QuizMeta {
  quizId: number;
  moduleId: number;
  courseId: number;
  title: string;
  description: string | null;
  passingScore: number;
  timeLimitMinutes: number | null;
}

interface AnswerOption {
  answerId: number;
  answerText: string;
  isCorrect: boolean;
  answerOrder: number;
}

interface QuestionRow {
  questionId: number;
  questionText: string;
  questionType: QuizQuestionType;
  points: number;
  explanation: string | null;
  questionOrder: number;
  config: Record<string, unknown> | null;
  answers: AnswerOption[];
}

interface AttemptState {
  attempt: AttemptRow;
  quiz: QuizMeta;
  /** Active questions in authored order (questionOrder). */
  questions: QuestionRow[];
  answers: Map<number, AnswerRecord>;
}

interface StagedRecord {
  questionId: number;
  instanceId: number;
  historyCount: number;
  stagedAt: Date;
}

interface LastCompleted {
  attemptId: number;
  score: number;
  isPassed: boolean;
  completedAt: Date;
}

interface FinalizeOutcome {
  state: AttemptState;
  firstPass: boolean;
  passDelta: number;
  completedLessonIds: number[];
  balance: number;
}

interface TerminalConfig {
  labId: number;
  mode: 'answer' | 'check';
  answerFormat: 'choice' | 'text' | null;
  setup: string[];
  check: LabStepCheck | null;
}

/** Shape the mapper reads. Accepted texts and correctness are deliberately not part of it. */
interface LearnerSourceQuestion {
  questionId: number;
  questionText: string;
  questionType: QuizQuestionType;
  points: number;
  config: Record<string, unknown> | null;
  answers: Array<{ answerId: number; answerText: string }>;
}

/* ── Pure helpers ────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConfigInt(config: Record<string, unknown> | null, key: string): number {
  const value = config?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readConfigPenalties(config: Record<string, unknown> | null): { wrongPenalty: number; guessPenalty: number } {
  return {
    wrongPenalty: readConfigInt(config, 'wrongPenalty'),
    guessPenalty: readConfigInt(config, 'guessPenalty'),
  };
}

function misconfiguredQuestion(): AppError {
  return new AppError('This quiz question is misconfigured.', HTTP_STATUS.INTERNAL_SERVER_ERROR);
}

/** Terminal block of a question config. Setup and check stay server-side (only read here). */
function readTerminalConfig(config: Record<string, unknown> | null): TerminalConfig {
  const raw = config?.terminal;
  if (!isRecord(raw) || typeof raw.labId !== 'number' || (raw.mode !== 'answer' && raw.mode !== 'check')) {
    throw misconfiguredQuestion();
  }
  return {
    labId: raw.labId,
    mode: raw.mode,
    answerFormat: raw.answerFormat === 'text' ? 'text' : raw.answerFormat === 'choice' ? 'choice' : null,
    setup: Array.isArray(raw.setup) ? raw.setup.filter((command): command is string => typeof command === 'string') : [],
    check: isRecord(raw.check) ? (raw.check as unknown as LabStepCheck) : null,
  };
}

function expiresAtOf(startedAt: Date, timeLimitMinutes: number | null): Date | null {
  return timeLimitMinutes === null ? null : new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

/** Server clock only (D5): an attempt is expired once `now` is past startedAt + time limit. */
function isExpired(startedAt: Date, timeLimitMinutes: number | null, now: Date): boolean {
  const end = expiresAtOf(startedAt, timeLimitMinutes);
  return end !== null && now.getTime() > end.getTime();
}

function sumActivePoints(questions: QuestionRow[]): number {
  return questions.reduce((sum, question) => sum + question.points, 0);
}

function sumEarned(state: AttemptState): number {
  return state.questions.reduce((sum, question) => sum + (state.answers.get(question.questionId)?.pointsEarned ?? 0), 0);
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

function closedAttempt(): ConflictError {
  return new ConflictError('This quiz attempt is already completed.', [{ code: ERROR_CODES.ATTEMPT_CLOSED }]);
}

function timeExpired(): ConflictError {
  return new ConflictError('The time for this quiz attempt has run out.', [{ code: ERROR_CODES.QUIZ_TIME_EXPIRED }]);
}

function notInAttempt(): NotFoundError {
  return new NotFoundError('This question is not part of the attempt.', [{ code: ERROR_CODES.QUESTION_NOT_IN_ATTEMPT }]);
}

function emptyQuiz(): ConflictError {
  return new ConflictError('This quiz has no questions yet.', [{ code: ERROR_CODES.QUIZ_EMPTY }]);
}

function stageDto(
  attemptId: number,
  questionId: number,
  instance: { instanceId: number; status: TerminalStageDto['status']; terminalWsUrl: string | null; expiresAt: string | null },
  stagedAt: Date,
  provisioned: boolean,
): TerminalStageDto {
  return {
    attemptId,
    questionId,
    instanceId: instance.instanceId,
    status: instance.status,
    terminalWsUrl: instance.terminalWsUrl,
    expiresAt: instance.expiresAt,
    stagedAt: stagedAt.toISOString(),
    provisioned,
  };
}

/**
 * Learner-facing question mapper (allowlist, contracts 0.2 / 4.4). Emits only the
 * question text, instructions, buckets, option texts in deterministic shuffled
 * order, points, penalties and the per-attempt terminal block and response.
 * Correctness, option order from the solution, accepted texts, the explanation
 * and the raw config are never copied here.
 */
function toLearnerQuestionDto(
  question: LearnerSourceQuestion,
  view: {
    attemptId: number;
    position: number;
    terminal: LearnerQuizQuestionDto['terminal'];
    response: QuizAnswerResultDto | null;
  },
): LearnerQuizQuestionDto {
  const config = question.config;
  const hidesOptions =
    question.questionType === 'fill_blank' ||
    (question.questionType === 'terminal' &&
      (view.terminal?.mode === 'check' || view.terminal?.answerFormat === 'text'));
  const byId = new Map(question.answers.map((answer) => [answer.answerId, answer]));
  const orderedIds = hidesOptions
    ? []
    : orderOptions(
        view.attemptId,
        question.questionId,
        question.answers.map((answer) => answer.answerId),
        question.questionType,
      );
  const options = orderedIds.flatMap((answerId) => {
    const answer = byId.get(answerId);
    return answer ? [{ answerId: answer.answerId, answerText: answer.answerText }] : [];
  });
  const instructions = typeof config?.instructions === 'string' ? config.instructions : null;
  const buckets =
    question.questionType === 'bucket_sort' && Array.isArray(config?.buckets)
      ? config.buckets.filter((bucket): bucket is string => typeof bucket === 'string')
      : null;

  return {
    questionId: question.questionId,
    position: view.position,
    questionText: question.questionText,
    questionType: question.questionType,
    points: question.points,
    instructions,
    buckets,
    options,
    terminal: view.terminal,
    penalties: {
      wrongAnswer: readConfigInt(config, 'wrongPenalty'),
      guess: readConfigInt(config, 'guessPenalty'),
    },
    response: view.response,
  };
}

/** Correct answer shown in review only after the quiz is passed. */
function correctFor(question: QuestionRow): QuizReviewDto['questions'][number]['correct'] {
  const correctIds = question.answers.filter((answer) => answer.isCorrect).map((answer) => answer.answerId);
  const firstCorrectText = (): string => question.answers.find((answer) => answer.isCorrect)?.answerText ?? '';
  switch (question.questionType) {
    case 'multiple_choice':
    case 'true_false':
    case 'multiple_select':
      return { answerIds: correctIds };
    case 'fill_blank':
      return { text: firstCorrectText() };
    case 'ordering':
      return {
        orderedAnswerIds: [...question.answers]
          .sort((a, b) => a.answerOrder - b.answerOrder)
          .map((answer) => answer.answerId),
      };
    case 'bucket_sort':
      return {
        placements: question.answers.map((answer) => ({ answerId: answer.answerId, bucket: answer.answerOrder })),
      };
    case 'terminal': {
      const terminal = readTerminalConfig(question.config);
      if (terminal.mode === 'check') return null;
      return terminal.answerFormat === 'text' ? { text: firstCorrectText() } : { answerIds: correctIds };
    }
  }
}

function parseStoredResponse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/* ── Drizzle reads (quiz engine only; no other file is edited for them) ─ */

const attemptIdExpr = sql<number>`CAST(JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.attemptId')) AS SIGNED)`;
const stagedQuestionIdExpr = sql<number>`CAST(JSON_UNQUOTE(JSON_EXTRACT(${activityLogs.details}, '$.questionId')) AS SIGNED)`;

function parseStaged(details: unknown, createdAt: Date): StagedRecord | null {
  if (!isRecord(details)) return null;
  const { questionId, instanceId, historyCount } = details;
  if (typeof questionId !== 'number' || typeof instanceId !== 'number' || typeof historyCount !== 'number') {
    return null;
  }
  return { questionId, instanceId, historyCount, stagedAt: createdAt };
}

/** Quiz meta joined to module and course. `publishedOnly` applies the learner visibility rule. */
async function selectQuizMeta(exec: Exec, quizId: number, publishedOnly: boolean): Promise<QuizMeta | null> {
  const conditions = [eq(quizzes.quizId, quizId)];
  if (publishedOnly) {
    conditions.push(eq(quizzes.isPublished, true), eq(modules.isPublished, true), eq(academyCourses.isPublished, true));
  }
  const rows = await exec
    .select({
      quizId: quizzes.quizId,
      moduleId: quizzes.moduleId,
      courseId: modules.courseId,
      title: quizzes.title,
      description: quizzes.description,
      passingScore: quizzes.passingScore,
      timeLimitMinutes: quizzes.timeLimitMinutes,
    })
    .from(quizzes)
    .innerJoin(modules, eq(modules.moduleId, quizzes.moduleId))
    .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

/** Active questions with their options (solution fields included: server-side only). */
async function loadQuestions(exec: Exec, quizId: number): Promise<QuestionRow[]> {
  const questionRows = await exec
    .select({
      questionId: quizQuestions.questionId,
      questionText: quizQuestions.questionText,
      questionType: quizQuestions.questionType,
      points: quizQuestions.points,
      explanation: quizQuestions.explanation,
      questionOrder: quizQuestions.questionOrder,
      config: quizQuestions.config,
    })
    .from(quizQuestions)
    .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.isActive, true)))
    .orderBy(asc(quizQuestions.questionOrder), asc(quizQuestions.questionId));
  if (questionRows.length === 0) {
    return [];
  }
  const answerRows = await exec
    .select({
      questionId: quizAnswers.questionId,
      answerId: quizAnswers.answerId,
      answerText: quizAnswers.answerText,
      isCorrect: quizAnswers.isCorrect,
      answerOrder: quizAnswers.answerOrder,
    })
    .from(quizAnswers)
    .where(inArray(quizAnswers.questionId, questionRows.map((row) => row.questionId)))
    .orderBy(asc(quizAnswers.answerOrder), asc(quizAnswers.answerId));

  const answersByQuestion = new Map<number, AnswerOption[]>();
  for (const row of answerRows) {
    const list = answersByQuestion.get(row.questionId) ?? [];
    list.push({ answerId: row.answerId, answerText: row.answerText, isCorrect: row.isCorrect, answerOrder: row.answerOrder });
    answersByQuestion.set(row.questionId, list);
  }
  return questionRows.map((row) => ({
    questionId: row.questionId,
    questionText: row.questionText,
    questionType: row.questionType,
    points: row.points,
    explanation: row.explanation,
    questionOrder: row.questionOrder,
    config: row.config,
    answers: answersByQuestion.get(row.questionId) ?? [],
  }));
}

async function selectAttempt(exec: Exec, userId: number, attemptId: number): Promise<AttemptRow | null> {
  const rows = await exec
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.attemptId, attemptId), eq(quizAttempts.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function findOpenAttempt(exec: Exec, userId: number, quizId: number): Promise<AttemptRow | null> {
  const rows = await exec
    .select()
    .from(quizAttempts)
    .where(and(
      eq(quizAttempts.userId, userId),
      eq(quizAttempts.quizId, quizId),
      isNull(quizAttempts.completedAt),
    ))
    .orderBy(desc(quizAttempts.attemptId))
    .limit(1);
  return rows[0] ?? null;
}

/** Start times of this learner's attempts on the quiz within the rolling 24 h window, oldest first. */
async function loadRecentStarts(exec: Exec, userId: number, quizId: number, now: Date): Promise<Date[]> {
  const rows = await exec
    .select({ startedAt: quizAttempts.startedAt })
    .from(quizAttempts)
    .where(and(
      eq(quizAttempts.userId, userId),
      eq(quizAttempts.quizId, quizId),
      gte(quizAttempts.startedAt, new Date(now.getTime() - DAY_MS)),
    ))
    .orderBy(asc(quizAttempts.startedAt));
  return rows.map((row) => row.startedAt);
}

async function loadLastCompleted(exec: Exec, userId: number, quizId: number): Promise<LastCompleted | null> {
  const rows = await exec
    .select({
      attemptId: quizAttempts.attemptId,
      score: quizAttempts.score,
      isPassed: quizAttempts.isPassed,
      completedAt: quizAttempts.completedAt,
    })
    .from(quizAttempts)
    .where(and(
      eq(quizAttempts.userId, userId),
      eq(quizAttempts.quizId, quizId),
      isNotNull(quizAttempts.completedAt),
    ))
    .orderBy(desc(quizAttempts.completedAt), desc(quizAttempts.attemptId))
    .limit(1);
  const row = rows[0];
  if (!row || row.completedAt === null) {
    return null;
  }
  return { attemptId: row.attemptId, score: row.score, isPassed: row.isPassed, completedAt: row.completedAt };
}

async function firstPassedAttemptId(exec: Exec, userId: number, quizId: number): Promise<number | null> {
  const rows = await exec
    .select({ attemptId: quizAttempts.attemptId })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId), eq(quizAttempts.isPassed, true)))
    .orderBy(asc(quizAttempts.attemptId))
    .limit(1);
  return rows[0]?.attemptId ?? null;
}

async function assertUnanswered(exec: Exec, attemptId: number, questionId: number): Promise<void> {
  const rows = await exec
    .select({ userAnswerId: userQuizAnswers.userAnswerId })
    .from(userQuizAnswers)
    .where(and(eq(userQuizAnswers.attemptId, attemptId), eq(userQuizAnswers.questionId, questionId)))
    .limit(1);
  if (rows.length > 0) {
    throw new ConflictError('This question has already been answered.', [{ code: ERROR_CODES.QUESTION_ALREADY_ANSWERED }]);
  }
}

/** Latest QUIZ_TERMINAL_STAGED record of (user, attempt, question). */
async function latestStaged(exec: Exec, userId: number, attemptId: number, questionId: number): Promise<StagedRecord | null> {
  const rows = await exec
    .select({ details: activityLogs.details, createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .where(and(
      eq(activityLogs.userId, userId),
      eq(activityLogs.activityType, 'QUIZ_TERMINAL_STAGED'),
      sql`${attemptIdExpr} = ${attemptId}`,
      sql`${stagedQuestionIdExpr} = ${questionId}`,
    ))
    .orderBy(desc(activityLogs.logId))
    .limit(1);
  const row = rows[0];
  return row ? parseStaged(row.details, row.createdAt) : null;
}

/** Latest staged record per question of one attempt. */
async function loadStagedMap(exec: Exec, userId: number, attemptId: number): Promise<Map<number, StagedRecord>> {
  const rows = await exec
    .select({ details: activityLogs.details, createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .where(and(
      eq(activityLogs.userId, userId),
      eq(activityLogs.activityType, 'QUIZ_TERMINAL_STAGED'),
      sql`${attemptIdExpr} = ${attemptId}`,
    ))
    .orderBy(desc(activityLogs.logId));
  const staged = new Map<number, StagedRecord>();
  for (const row of rows) {
    const record = parseStaged(row.details, row.createdAt);
    if (record && !staged.has(record.questionId)) {
      staged.set(record.questionId, record);
    }
  }
  return staged;
}

async function loadLabNames(exec: Exec, labIds: number[]): Promise<Map<number, string>> {
  if (labIds.length === 0) {
    return new Map();
  }
  const rows = await exec
    .select({ labId: labs.labId, labName: labs.labName })
    .from(labs)
    .where(inArray(labs.labId, labIds));
  return new Map(rows.map((row) => [row.labId, row.labName]));
}

/** Running balance = points_balance_after of the latest ledger row (D1). */
async function latestBalance(exec: Exec, userId: number): Promise<number> {
  const rows = await exec
    .select({ balance: pointsHistory.pointsBalanceAfter })
    .from(pointsHistory)
    .where(eq(pointsHistory.userId, userId))
    .orderBy(desc(pointsHistory.historyId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

/**
 * Quiz penalty ledger rows of one attempt (keys quiz_wrong / quiz_guess, contracts 5.1).
 * Returns the total deducted (positive) and the questions whose guess penalty was recorded.
 */
async function loadQuizPenalties(
  exec: Exec,
  userId: number,
  attemptId: number,
): Promise<{ total: number; guessed: Set<number> }> {
  const wrongPattern = `${escapeLike(`[k:quiz_wrong:${attemptId}:`)}%`;
  const guessPattern = `${escapeLike(`[k:quiz_guess:${attemptId}:`)}%`;
  const rows = await exec
    .select({ description: pointsHistory.description, pointsChange: pointsHistory.pointsChange })
    .from(pointsHistory)
    .where(and(
      eq(pointsHistory.userId, userId),
      eq(pointsHistory.sourceType, 'penalty'),
      or(
        sql`${pointsHistory.description} COLLATE utf8mb4_bin LIKE ${wrongPattern} ESCAPE '!'`,
        sql`${pointsHistory.description} COLLATE utf8mb4_bin LIKE ${guessPattern} ESCAPE '!'`,
      ),
    ));
  let total = 0;
  const guessed = new Set<number>();
  for (const row of rows) {
    total -= row.pointsChange;
    const match = /^\[k:quiz_(wrong|guess):\d+:(\d+)\] /.exec(row.description ?? '');
    if (match && match[1] === 'guess') {
      guessed.add(Number(match[2]));
    }
  }
  return { total, guessed };
}

/** Learner result of one stored answer (penalties are the question's configured values). */
function answerResultDto(
  question: QuestionRow,
  record: AnswerRecord,
  guessed: boolean,
  xp: XpDeltaDto,
): QuizAnswerResultDto {
  const penalties = readConfigPenalties(question.config);
  return {
    questionId: question.questionId,
    isCorrect: record.isCorrect,
    pointsEarned: record.pointsEarned,
    guessed,
    penalties: { wrongAnswer: penalties.wrongPenalty, guess: penalties.guessPenalty },
    explanation: question.explanation,
    answeredAt: record.answeredAt.toISOString(),
    xp,
  };
}

/* ── Service ─────────────────────────────────────────────────────────── */

/**
 * F5 quiz attempt engine (contracts 4.4). The server creates attempts, serves one
 * shuffled question set per attempt, grades each answer when it is submitted, applies
 * penalties and the first-pass reward through the award ledger, and finalizes the
 * attempt on completion or expiry. Every write that touches the learner's ledger runs
 * inside `awardService.withUserLock`; network work (lab provisioning, setup, checks)
 * always runs outside it.
 */
export class QuizAttemptService {
  constructor(private readonly deps: QuizAttemptServiceDeps = defaultDeps()) {}

  /** GET /progress/quizzes/:quizId: intro payload with the caller's gates. */
  async getStatus(userId: number, quizId: number, roles: string[] = []): Promise<QuizStatusDto> {
    const quiz = await this.loadAccessibleQuiz(userId, quizId, roles);
    const questions = await loadQuestions(db, quiz.quizId);
    if (questions.length === 0) {
      throw emptyQuiz();
    }

    let open = await findOpenAttempt(db, userId, quiz.quizId);
    if (open && isExpired(open.startedAt, quiz.timeLimitMinutes, new Date())) {
      await this.finalizeExpired(userId, open.attemptId);
      open = null;
    }

    const now = new Date();
    const starts = await loadRecentStarts(db, userId, quiz.quizId, now);
    const last = await loadLastCompleted(db, userId, quiz.quizId);
    const stats = (await this.deps.repo.quizAttemptStats(userId, [quiz.quizId])).get(quiz.quizId);
    const passedAttemptId = await firstPassedAttemptId(db, userId, quiz.quizId);
    const gate = computeGate(starts, last, now);
    const isPassed = stats?.isPassed ?? false;
    const nextAttempt = [gate.capUnlocksAt, gate.cooldownEndsAt]
      .filter((time): time is Date => time !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      quizId: quiz.quizId,
      moduleId: quiz.moduleId,
      courseId: quiz.courseId,
      title: quiz.title,
      description: quiz.description,
      passingScore: quiz.passingScore,
      timeLimitMinutes: quiz.timeLimitMinutes,
      questionCount: questions.length,
      totalPoints: sumActivePoints(questions),
      isPassed,
      bestScore: stats?.bestScore ?? null,
      attemptsUsedToday: starts.length,
      maxAttemptsPerDay: QUIZ_LIMITS.maxAttemptsPerDay,
      nextAttemptAt: isPassed || !nextAttempt ? null : nextAttempt.toISOString(),
      openAttemptId: open?.attemptId ?? null,
      penalties: {
        wrongAnswerMax: Math.max(0, ...questions.map((question) => readConfigPenalties(question.config).wrongPenalty)),
        terminalGuessMax: Math.max(0, ...questions.map((question) => readConfigPenalties(question.config).guessPenalty)),
      },
      hasTerminalQuestions: questions.some((question) => question.questionType === 'terminal'),
      passedAttemptId,
      lastAttempt: last
        ? {
            attemptId: last.attemptId,
            score: last.score,
            isPassed: last.isPassed,
            completedAt: last.completedAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * POST /progress/quizzes/:quizId/attempts/start. Returns the open attempt when one is
   * still running (`resumed: true`), otherwise creates a new one (`resumed: false`).
   */
  async start(
    userId: number,
    quizId: number,
    roles: string[] = [],
  ): Promise<{ attempt: QuizAttemptStartDto; resumed: boolean }> {
    const quiz = await this.loadAccessibleQuiz(userId, quizId, roles);
    if ((await loadQuestions(db, quiz.quizId)).length === 0) {
      throw emptyQuiz();
    }

    const outcome = await awardService.withUserLock(userId, async (tx) => {
      const now = new Date();
      if (await this.deps.repo.hasPassedQuizAttempt(userId, quiz.quizId, tx)) {
        throw new ConflictError('You have already passed this quiz.', [{ code: ERROR_CODES.QUIZ_ALREADY_PASSED }]);
      }

      let finalized: FinalizeOutcome | null = null;
      const open = await findOpenAttempt(tx, userId, quiz.quizId);
      if (open) {
        if (!isExpired(open.startedAt, quiz.timeLimitMinutes, now)) {
          const state = await this.loadState(tx, userId, open.attemptId);
          return { attempt: await this.buildAttemptDto(tx, userId, state), resumed: true, finalized };
        }
        // Expired attempts are finalized by whichever call meets them first (contracts 4.4).
        finalized = await this.finalizeTx(tx, userId, open.attemptId, now);
        if (finalized?.state.attempt.isPassed) {
          // The expired attempt passed on finalization: keep that commit and refuse a new attempt.
          return { attempt: null, resumed: false, finalized };
        }
      }

      const starts = await loadRecentStarts(tx, userId, quiz.quizId, now);
      const last = await loadLastCompleted(tx, userId, quiz.quizId);
      enforceAttemptGate(computeGate(starts, last, now), now);

      const [{ value: priorAttempts }] = await tx
        .select({ value: count() })
        .from(quizAttempts)
        .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quiz.quizId)));
      const inserted = await tx.insert(quizAttempts).values({
        userId,
        quizId: quiz.quizId,
        score: 0,
        isPassed: false,
        attemptNumber: priorAttempts + 1,
        startedAt: now,
        completedAt: null,
        timeTakenSeconds: null,
      });
      const attemptId = inserted[0].insertId;
      await activityLogService.recordEvent(userId, 'QUIZ_STARTED', { quizId: quiz.quizId, attemptId }, tx);

      const state = await this.loadState(tx, userId, attemptId);
      return { attempt: await this.buildAttemptDto(tx, userId, state), resumed: false, finalized };
    });

    if (outcome.finalized) {
      await this.afterQuizEvent(userId, outcome.finalized.completedLessonIds);
    }
    if (!outcome.attempt) {
      throw new ConflictError('You have already passed this quiz.', [{ code: ERROR_CODES.QUIZ_ALREADY_PASSED }]);
    }
    return { attempt: outcome.attempt, resumed: outcome.resumed };
  }

  /** GET /progress/quiz-attempts/:attemptId: resume payload; `result` once the attempt is completed or expired. */
  async getAttempt(
    userId: number,
    attemptId: number,
    roles: string[] = [],
  ): Promise<{ attempt: QuizAttemptStartDto; result: QuizAttemptResultDto | null }> {
    const attempt = await this.requireOwnedAttempt(db, userId, attemptId);
    const quiz = await this.loadAccessibleQuiz(userId, attempt.quizId, roles);
    if (!attempt.completedAt && isExpired(attempt.startedAt, quiz.timeLimitMinutes, new Date())) {
      await this.finalizeExpired(userId, attemptId);
    }

    const state = await this.loadState(db, userId, attemptId);
    const attemptDto = await this.buildAttemptDto(db, userId, state);
    if (!state.attempt.completedAt) {
      return { attempt: attemptDto, result: null };
    }
    const firstPassId = await firstPassedAttemptId(db, userId, quiz.quizId);
    const result = await this.buildResultDto(db, userId, state, {
      firstPass: state.attempt.isPassed && firstPassId === attemptId,
      xp: { delta: 0, balance: await latestBalance(db, userId) },
      completedLessonIds: [],
    });
    return { attempt: attemptDto, result };
  }

  /**
   * POST .../questions/:questionId/stage. Reuses the learner's running instance of the
   * terminal lab, provisions one when none is active, runs the question's setup and records
   * the shell history count used later for guess detection.
   */
  async stageTerminal(
    userId: number,
    attemptId: number,
    questionId: number,
    region: VpnRegion | null = null,
    roles: string[] = [],
  ): Promise<TerminalStageDto> {
    const attempt = await this.requireOwnedAttempt(db, userId, attemptId);
    const quiz = await this.loadAccessibleQuiz(userId, attempt.quizId, roles);
    this.assertOpen(attempt);
    if (isExpired(attempt.startedAt, quiz.timeLimitMinutes, new Date())) {
      await this.finalizeExpired(userId, attemptId);
      throw timeExpired();
    }

    const question = await this.requireActiveQuestion(db, quiz.quizId, questionId);
    if (question.questionType !== 'terminal') {
      throw notInAttempt();
    }
    await assertUnanswered(db, attemptId, questionId);
    const terminal = readTerminalConfig(question.config);

    const current = await labService.getActiveInstance(userId);
    let instance: {
      instanceId: number;
      status: TerminalStageDto['status'];
      terminalWsUrl: string | null;
      expiresAt: string | null;
    };
    let provisioned: boolean;
    if (current) {
      if (current.labId !== terminal.labId || current.status !== 'running') {
        throw new ConflictError('You already have an active lab environment. Terminate it first.', [
          { code: ERROR_CODES.INSTANCE_ALREADY_ACTIVE, instanceId: current.instanceId, labId: current.labId },
        ]);
      }
      instance = current;
      provisioned = false;
      // Re-stage on the same running instance returns the existing record without rerunning setup.
      const existing = await latestStaged(db, userId, attemptId, questionId);
      if (existing && existing.instanceId === current.instanceId) {
        return stageDto(attemptId, questionId, instance, existing.stagedAt, false);
      }
    } else {
      // Provisioning takes the user lock itself and waits for the container: no lock is held here.
      const created = await labService.provisionInstance(userId, terminal.labId, region);
      instance = created;
      provisioned = true;
    }

    const lockKey = `lock:stage:quiz:${attemptId}:${questionId}`;
    await acquireStageMutex(lockKey);
    try {
      await labCheckService.runSetup(instance.instanceId, terminal.setup);
      const historyCount = await labCheckService.readHistoryCount(instance.instanceId);
      const stagedAt = await awardService.withUserLock(userId, async (tx) => {
        const locked = await this.requireOwnedAttempt(tx, userId, attemptId);
        this.assertOpen(locked);
        await assertUnanswered(tx, attemptId, questionId);
        const existing = await latestStaged(tx, userId, attemptId, questionId);
        if (existing && existing.instanceId === instance.instanceId) {
          return existing.stagedAt;
        }
        const now = new Date();
        await activityLogService.recordEvent(
          userId,
          'QUIZ_TERMINAL_STAGED',
          {
            attemptId,
            questionId,
            quizId: quiz.quizId,
            labId: terminal.labId,
            instanceId: instance.instanceId,
            historyCount,
          },
          tx,
        );
        return now;
      });
      return stageDto(attemptId, questionId, instance, stagedAt, provisioned);
    } finally {
      await releaseStageMutex(lockKey);
    }
  }

  /**
   * POST /progress/quiz-attempts/:attemptId/answers. Grades one question, writes the answer
   * and applies the wrong-answer and guess penalties once per question.
   */
  async submitAnswer(
    userId: number,
    attemptId: number,
    body: SubmitQuizAnswerBody,
    roles: string[] = [],
  ): Promise<QuizAnswerResultDto> {
    const attempt = await this.requireOwnedAttempt(db, userId, attemptId);
    const quiz = await this.loadAccessibleQuiz(userId, attempt.quizId, roles);
    this.assertOpen(attempt);
    if (isExpired(attempt.startedAt, quiz.timeLimitMinutes, new Date())) {
      await this.finalizeExpired(userId, attemptId);
      throw timeExpired();
    }

    const question = await this.requireActiveQuestion(db, quiz.quizId, body.questionId);
    await assertUnanswered(db, attemptId, question.questionId);
    assertResponseShape(question, body.response);

    // Grading and the terminal checks run before the lock: they may touch the network.
    let isCorrect: boolean;
    let guessed = false;
    if (question.questionType === 'terminal') {
      const terminal = readTerminalConfig(question.config);
      const stage = await this.requireStagedInstance(userId, attemptId, question.questionId, terminal.labId);
      if (terminal.mode === 'check') {
        if (!terminal.check) {
          throw misconfiguredQuestion();
        }
        isCorrect = (await labCheckService.evaluate(stage.instanceId, terminal.check)).passed;
      } else {
        guessed = (await labCheckService.readHistoryCount(stage.instanceId)) <= stage.historyCount;
        isCorrect = gradeResponse(question, body.response);
      }
    } else {
      isCorrect = gradeResponse(question, body.response);
    }

    const penalties = readConfigPenalties(question.config);
    const pointsEarned = isCorrect ? question.points : 0;
    const answerId = body.response.type === 'choice' ? body.response.answerId : null;
    const answerText = JSON.stringify(body.response);

    const outcome = await awardService.withUserLock(userId, async (tx) => {
      const now = new Date();
      const locked = await this.requireOwnedAttempt(tx, userId, attemptId);
      this.assertOpen(locked);
      if (isExpired(locked.startedAt, quiz.timeLimitMinutes, now)) {
        return { expired: true as const };
      }
      await assertUnanswered(tx, attemptId, question.questionId);

      await tx.insert(userQuizAnswers).values({
        attemptId,
        questionId: question.questionId,
        answerId,
        answerText,
        isCorrect,
        pointsEarned,
        answeredAt: now,
      });

      let delta = 0;
      if (!isCorrect && penalties.wrongPenalty > 0) {
        const applied = await awardService.apply(tx, {
          userId,
          key: awardKeys.quizWrong(attemptId, question.questionId),
          points: -penalties.wrongPenalty,
          sourceType: 'penalty',
          sourceId: quiz.quizId,
          label: `Wrong answer: ${quiz.title}`,
        });
        delta += applied.pointsChange;
      }
      if (guessed && penalties.guessPenalty > 0) {
        const applied = await awardService.apply(tx, {
          userId,
          key: awardKeys.quizGuess(attemptId, question.questionId),
          points: -penalties.guessPenalty,
          sourceType: 'penalty',
          sourceId: quiz.quizId,
          label: `Guessed terminal answer: ${quiz.title}`,
        });
        delta += applied.pointsChange;
      }
      return {
        expired: false as const,
        answeredAt: now,
        xp: { delta, balance: await awardService.balance(tx, userId) },
      };
    });

    if (outcome.expired) {
      await this.finalizeExpired(userId, attemptId);
      throw timeExpired();
    }
    return {
      questionId: question.questionId,
      isCorrect,
      pointsEarned,
      guessed,
      penalties: { wrongAnswer: penalties.wrongPenalty, guess: penalties.guessPenalty },
      explanation: question.explanation,
      answeredAt: outcome.answeredAt.toISOString(),
      xp: outcome.xp,
    };
  }

  /** POST /progress/quiz-attempts/:attemptId/complete. Expired attempts are finalized by the same rules. */
  async complete(userId: number, attemptId: number, roles: string[] = []): Promise<QuizAttemptResultDto> {
    const attempt = await this.requireOwnedAttempt(db, userId, attemptId);
    await this.loadAccessibleQuiz(userId, attempt.quizId, roles);

    const outcome = await awardService.withUserLock(userId, (tx) =>
      this.finalizeTx(tx, userId, attemptId, new Date()),
    );
    if (!outcome) {
      throw closedAttempt();
    }
    await this.afterQuizEvent(userId, outcome.completedLessonIds);
    return this.buildResultDto(db, userId, outcome.state, {
      firstPass: outcome.firstPass,
      xp: { delta: outcome.passDelta, balance: outcome.balance },
      completedLessonIds: outcome.completedLessonIds,
    });
  }

  /** GET /progress/quiz-attempts/:attemptId/review. Only after the quiz is passed. */
  async getReview(userId: number, attemptId: number, roles: string[] = []): Promise<QuizReviewDto> {
    const attempt = await this.requireOwnedAttempt(db, userId, attemptId);
    await this.loadAccessibleQuiz(userId, attempt.quizId, roles);
    if (!(await this.deps.repo.hasPassedQuizAttempt(userId, attempt.quizId))) {
      throw new ConflictError('Pass the quiz to unlock the review.', [{ code: ERROR_CODES.QUIZ_NOT_PASSED }]);
    }

    const state = await this.loadState(db, userId, attemptId);
    return {
      attemptId,
      questions: state.questions.map((question) => {
        const answer = state.answers.get(question.questionId);
        return {
          questionId: question.questionId,
          questionText: question.questionText,
          questionType: question.questionType,
          yourResponse: answer ? parseStoredResponse(answer.answerText) : null,
          isCorrect: answer?.isCorrect ?? false,
          explanation: question.explanation,
          correct: correctFor(question),
        };
      }),
    };
  }

  /** F5-API-08: learner's attempt history for one quiz (unchanged). */
  async getAttemptHistory(userId: number, quizId: number): Promise<QuizAttemptDto[]> {
    const quiz = await curriculumService.getQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.');
    }
    const rows = await this.deps.repo.listQuizAttemptsByQuiz(userId, quizId);
    return rows.map((row) => ({
      attemptId: row.attemptId,
      quizId,
      score: row.score,
      isPassed: row.isPassed,
      attemptNumber: row.attemptNumber,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      timeTakenSeconds: row.timeTakenSeconds,
    }));
  }

  /* ── Finalization (lazy expiry and complete) ───────────────────────── */

  /**
   * Finalizes one attempt inside the caller's locked transaction: scores the answers
   * (unanswered = 0, no penalty), sets completed_at and the server-side time taken, awards
   * the first pass and completes the linked module items, then records the pass event.
   * Returns null when the attempt is missing or already completed.
   */
  private async finalizeTx(tx: Tx, userId: number, attemptId: number, now: Date): Promise<FinalizeOutcome | null> {
    const attempt = await selectAttempt(tx, userId, attemptId);
    if (!attempt || attempt.completedAt !== null) {
      return null;
    }
    const state = await this.loadState(tx, userId, attemptId);
    const { quiz } = state;

    const totalPoints = sumActivePoints(state.questions);
    const earned = sumEarned(state);
    const score = totalPoints > 0 ? Math.round((earned * 100) / totalPoints) : 0;
    const isPassed = score >= quiz.passingScore;
    // Time is capped at the deadline: a late finalize never counts time past the limit.
    const expiresAt = expiresAtOf(attempt.startedAt, quiz.timeLimitMinutes);
    const endAt = expiresAt !== null && now.getTime() > expiresAt.getTime() ? expiresAt : now;
    const timeTakenSeconds = Math.max(0, Math.round((endAt.getTime() - attempt.startedAt.getTime()) / 1000));

    let firstPass = false;
    let passDelta = 0;
    let completedLessonIds: number[] = [];
    if (isPassed && !(await this.deps.repo.hasPassedQuizAttempt(userId, quiz.quizId, tx))) {
      firstPass = true;
      const applied = await awardService.apply(tx, {
        userId,
        key: awardKeys.quizPass(quiz.quizId),
        points: earned,
        sourceType: 'course_complete',
        sourceId: quiz.quizId,
        label: `Quiz passed: ${quiz.title}`,
      });
      passDelta = applied.pointsChange;
      completedLessonIds = await progressCompletionHooks.completeQuizItems(tx, userId, quiz.quizId);
    }

    await tx
      .update(quizAttempts)
      .set({ score, isPassed, completedAt: now, timeTakenSeconds })
      .where(eq(quizAttempts.attemptId, attemptId));
    await activityLogService.recordEvent(
      userId,
      isPassed ? 'QUIZ_PASSED' : 'QUIZ_FAILED',
      { quizId: quiz.quizId, attemptId, score, attemptNumber: attempt.attemptNumber },
      tx,
    );

    return {
      state: await this.loadState(tx, userId, attemptId),
      firstPass,
      passDelta,
      completedLessonIds,
      balance: await awardService.balance(tx, userId),
    };
  }

  /** Lazy expiry: finalizes an expired open attempt under its own lock (caller checks expiry first). */
  private async finalizeExpired(userId: number, attemptId: number): Promise<void> {
    const outcome = await awardService.withUserLock(userId, (tx) =>
      this.finalizeTx(tx, userId, attemptId, new Date()),
    );
    if (outcome) {
      await this.afterQuizEvent(userId, outcome.completedLessonIds);
    }
  }

  /** Post-commit follow-up (contracts 5.3). Never throws into the quiz response. */
  private async afterQuizEvent(userId: number, completedLessonIds: number[] = []): Promise<void> {
    await progressCompletionHooks.afterCommit(userId, completedLessonIds);
    try {
      await gamificationService.afterLearningEvent(userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'Gamification follow-up after a quiz event failed');
    }
  }

  /* ── Loading and mapping ───────────────────────────────────────────── */

  /** Quiz that the learner may see: published chain, course access (D6). */
  private async loadAccessibleQuiz(userId: number, quizId: number, roles: string[] = []): Promise<QuizMeta> {
    const quiz = await selectQuizMeta(db, quizId, true);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.', [{ code: ERROR_CODES.QUIZ_NOT_FOUND }]);
    }
    const access = await courseAccessService.getCourseAccess(
      { userId, ipAddress: null, userAgent: null, roles },
      quiz.courseId,
    );
    if (!access.canAccess) {
      const message = access.message ?? 'You do not have access to this course. Ask your organization admin for access.';
      throw new ForbiddenError(message, [{ code: ERROR_CODES.COURSE_ACCESS_DENIED, reason: access.reason, message }]);
    }
    return quiz;
  }

  private async requireOwnedAttempt(exec: Exec, userId: number, attemptId: number): Promise<AttemptRow> {
    const attempt = await selectAttempt(exec, userId, attemptId);
    if (!attempt) {
      throw new NotFoundError('Quiz attempt not found.', [{ code: ERROR_CODES.ATTEMPT_NOT_FOUND }]);
    }
    return attempt;
  }

  private assertOpen(attempt: AttemptRow): void {
    if (attempt.completedAt !== null) {
      throw closedAttempt();
    }
  }

  private async requireActiveQuestion(exec: Exec, quizId: number, questionId: number): Promise<QuestionRow> {
    const question = (await loadQuestions(exec, quizId)).find((row) => row.questionId === questionId);
    if (!question) {
      throw notInAttempt();
    }
    return question;
  }

  /** The stored stage must still belong to the learner's running instance of the terminal lab (409 otherwise). */
  private async requireStagedInstance(
    userId: number,
    attemptId: number,
    questionId: number,
    labId: number,
  ): Promise<{ instanceId: number; historyCount: number }> {
    const staged = await latestStaged(db, userId, attemptId, questionId);
    const instance = staged ? await labsRepository.findInstanceForUser(userId, staged.instanceId) : null;
    if (!staged || !instance || instance.status !== 'running' || instance.labId !== labId) {
      throw new ConflictError('Start the terminal environment for this question first.', [
        { code: ERROR_CODES.TERMINAL_NOT_STAGED },
      ]);
    }
    return { instanceId: staged.instanceId, historyCount: staged.historyCount };
  }

  /** Attempt, quiz, active questions and the learner's stored answers. */
  private async loadState(exec: Exec, userId: number, attemptId: number): Promise<AttemptState> {
    const attempt = await this.requireOwnedAttempt(exec, userId, attemptId);
    const quiz = await selectQuizMeta(exec, attempt.quizId, false);
    if (!quiz) {
      throw new NotFoundError('Quiz not found.', [{ code: ERROR_CODES.QUIZ_NOT_FOUND }]);
    }
    const questions = await loadQuestions(exec, attempt.quizId);
    const answerRows = await exec.select().from(userQuizAnswers).where(eq(userQuizAnswers.attemptId, attemptId));
    return {
      attempt,
      quiz,
      questions,
      answers: new Map(answerRows.map((row) => [row.questionId, row])),
    };
  }

  /** Learner view of an attempt: shuffled questions, terminal block and stored responses. */
  private async buildAttemptDto(exec: Exec, userId: number, state: AttemptState): Promise<QuizAttemptStartDto> {
    const { attempt, quiz, questions, answers } = state;
    const byId = new Map(questions.map((question) => [question.questionId, question]));
    const ordered = orderQuestions(attempt.attemptId, questions.map((question) => question.questionId));
    const staged = await loadStagedMap(exec, userId, attempt.attemptId);
    const labNames = await loadLabNames(
      exec,
      questions.flatMap((question) => (question.questionType === 'terminal' ? [readTerminalConfig(question.config).labId] : [])),
    );
    const penalties = answers.size > 0 ? await loadQuizPenalties(exec, userId, attempt.attemptId) : null;
    const balance = answers.size > 0 ? await latestBalance(exec, userId) : 0;

    const learnerQuestions: LearnerQuizQuestionDto[] = [];
    ordered.forEach((questionId, index) => {
      const question = byId.get(questionId);
      if (!question) {
        return;
      }
      const terminalConfig = question.questionType === 'terminal' ? readTerminalConfig(question.config) : null;
      const record = staged.get(question.questionId) ?? null;
      const answer = answers.get(question.questionId);
      learnerQuestions.push(
        toLearnerQuestionDto(question, {
          attemptId: attempt.attemptId,
          position: index + 1,
          terminal: terminalConfig
            ? {
                labId: terminalConfig.labId,
                labName: labNames.get(terminalConfig.labId) ?? '',
                mode: terminalConfig.mode,
                answerFormat: terminalConfig.answerFormat,
                staged: record ? { instanceId: record.instanceId, stagedAt: record.stagedAt.toISOString() } : null,
              }
            : null,
          response: answer
            ? answerResultDto(
                question,
                answer,
                penalties?.guessed.has(question.questionId) ?? false,
                { delta: 0, balance },
              )
            : null,
        }),
      );
    });

    return {
      attemptId: attempt.attemptId,
      quizId: quiz.quizId,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt.toISOString(),
      expiresAt: expiresAtOf(attempt.startedAt, quiz.timeLimitMinutes)?.toISOString() ?? null,
      passingScore: quiz.passingScore,
      totalQuestions: questions.length,
      totalPoints: sumActivePoints(questions),
      questions: learnerQuestions,
    };
  }

  /** Completed-attempt summary (complete and GET result). */
  private async buildResultDto(
    exec: Exec,
    userId: number,
    state: AttemptState,
    extras: { firstPass: boolean; xp: XpDeltaDto; completedLessonIds: number[] },
  ): Promise<QuizAttemptResultDto> {
    const { attempt, quiz, questions, answers } = state;
    const answered = questions.filter((question) => answers.has(question.questionId));
    const penalties = await loadQuizPenalties(exec, userId, attempt.attemptId);
    return {
      attemptId: attempt.attemptId,
      quizId: quiz.quizId,
      score: attempt.score,
      isPassed: attempt.isPassed,
      passingScore: quiz.passingScore,
      correctCount: answered.filter((question) => answers.get(question.questionId)?.isCorrect).length,
      answeredCount: answered.length,
      totalQuestions: questions.length,
      timeTakenSeconds: attempt.timeTakenSeconds ?? 0,
      firstPass: extras.firstPass,
      xpAwarded: extras.firstPass ? sumEarned(state) : 0,
      penaltiesTotal: penalties.total,
      breakdown: questions.map((question) => {
        const answer = answers.get(question.questionId);
        return {
          questionId: question.questionId,
          isCorrect: answer?.isCorrect ?? false,
          pointsEarned: answer?.pointsEarned ?? 0,
          explanation: answer ? question.explanation : null,
        };
      }),
      reviewAvailable: await this.deps.repo.hasPassedQuizAttempt(userId, quiz.quizId, exec),
      completedLessonIds: extras.completedLessonIds,
      xp: extras.xp,
    };
  }

}

/** Daily cap and cooldown from the attempt history (QUIZ_LIMITS, 0 = unlimited cap). */
function computeGate(
  starts: Date[],
  last: LastCompleted | null,
  now: Date,
): { capUnlocksAt: Date | null; cooldownEndsAt: Date | null } {
  const max = QUIZ_LIMITS.maxAttemptsPerDay;
  let capUnlocksAt: Date | null = null;
  if (max > 0 && starts.length >= max) {
    // Removing the oldest starts[length - max] + 1 attempts brings the count under the cap.
    const anchor = starts[starts.length - max];
    if (anchor) {
      capUnlocksAt = new Date(anchor.getTime() + DAY_MS);
    }
  }
  let cooldownEndsAt: Date | null = null;
  if (last && !last.isPassed) {
    const end = new Date(last.completedAt.getTime() + QUIZ_LIMITS.retryCooldownSeconds * 1000);
    if (end.getTime() > now.getTime()) {
      cooldownEndsAt = end;
    }
  }
  return { capUnlocksAt, cooldownEndsAt };
}

function enforceAttemptGate(gate: { capUnlocksAt: Date | null; cooldownEndsAt: Date | null }, now: Date): void {
  if (gate.capUnlocksAt) {
    throw new AppError(
      'You have reached the daily attempt limit for this quiz. Try again later.',
      HTTP_STATUS.TOO_MANY_REQUESTS,
      [{ code: ERROR_CODES.QUIZ_ATTEMPT_LIMIT, retryAfterSeconds: secondsUntil(gate.capUnlocksAt, now) }],
    );
  }
  if (gate.cooldownEndsAt) {
    throw new AppError('Please wait before retrying this quiz.', HTTP_STATUS.TOO_MANY_REQUESTS, [
      { code: ERROR_CODES.QUIZ_COOLDOWN, retryAfterSeconds: secondsUntil(gate.cooldownEndsAt, now) },
    ]);
  }
}

/** Redis NX mutex for one terminal stage (`lock:stage:quiz:{attemptId}:{questionId}`). */
async function acquireStageMutex(key: string): Promise<void> {
  let acquired: string | null;
  try {
    acquired = await redisClient.set(key, '1', 'PX', STAGE_MUTEX_TTL_MS, 'NX');
  } catch (error) {
    logger.error({ err: error, key }, 'Quiz stage mutex unavailable');
    throw new AppError('The lab environment is unreachable. Please try again.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
      { code: ERROR_CODES.LAB_ENV_UNREACHABLE },
    ]);
  }
  if (acquired !== 'OK') {
    throw new ConflictError('A stage request for this question is already in progress.', [
      { code: ERROR_CODES.STEP_STAGE_IN_PROGRESS },
    ]);
  }
}

async function releaseStageMutex(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error({ err: error, key }, 'Could not release the quiz stage mutex');
  }
}

export const quizAttemptService = new QuizAttemptService();
