import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import { pointsHistory } from '../../../app/database/schema';
import { redisClient } from '../../../app/cache/redis';
import { HTTP_STATUS } from '../../../shared/constants';
import { AppError, ConflictError, ERROR_CODES, NotFoundError, ValidationError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { activityLogService, type ActivityLogService } from '../../progress/services/ActivityLogService';
import { progressCompletionHooks } from '../../progress/services/progress-completion.hooks';
import { awardService, type AwardService } from '../../gamification/services/award.service';
import { awardKeys, escapeLike, parseAwardKey, type AwardKind } from '../../gamification/config/award-keys';
import { gamificationService, type GamificationService } from '../../gamification/services/gamification.service';
import type { LabSpecV2, LabStepV2 } from '../dto/lab-spec.dto';
import type {
  HintRevealResultDto,
  LabStepCheckReason,
  LabStepCheckResultDto,
  LabStepStageResultDto,
  LabStepStatus,
  LabStepsStateDto,
  LearnerLabStepDto,
} from '../dto/labs.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { EntitlementService } from './EntitlementService';
import { entitlementService } from './EntitlementService';
import type { LabCheckService } from './LabCheckService';
import { labCheckService, normalizeAnswer, scalePoints } from './LabCheckService';
import type { InstanceRow, LabActivityRow, LabRow, LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';
import { parseLabSpec } from '../validators/lab-spec.validator';

/**
 * Learner lab steps (contracts 4.1): state, stage, check, hint reveal and
 * completion. Every once-only write runs inside `awardService.withUserLock`
 * and re-reads the state with the locked `tx`. Commands, outputs, answers and
 * hint text are never logged; check and setup commands never leave the server.
 */

/** Redis mutex TTL for one stage request (setup budget is 60 s). */
const STAGE_LOCK_TTL_MS = 90_000;
/** Grace period after completion so the TTL monitor reaps the instance (contracts 4.1). */
const COMPLETED_GRACE_MINUTES = 5;

/** Lab-scoped ledger kinds written by this service (contracts 5.1). */
const LAB_AWARD_KINDS: ReadonlySet<AwardKind> = new Set<AwardKind>([
  'lab_step',
  'lab_done',
  'lab_hint',
  'lab_wrong',
  'lab_guess',
]);

const STATE_EVENT_TYPES = ['LAB_STEP_STAGED', 'LAB_STEP_PASSED', 'LAB_HINT_REVEALED', 'LAB_COMPLETED'];
const PASS_EVENT_TYPES = ['LAB_STEP_PASSED', 'LAB_COMPLETED'];
const HINT_EVENT_TYPES = ['LAB_STEP_PASSED', 'LAB_HINT_REVEALED', 'LAB_COMPLETED'];

/** Compare-and-delete: only the holder of the token releases the stage mutex. */
const RELEASE_STAGE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

export interface LabStepServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'findLabById'
    | 'findProLabByLabId'
    | 'getPointsMultiplier'
    | 'findInstanceForUser'
    | 'findAnyActiveInstanceForUser'
    | 'findLabStartTime'
    | 'listLabActivity'
    | 'findLatestStageRecord'
    | 'insertActivity'
    | 'updateInstanceExpiry'
  >;
  orchestration: Pick<ContainerOrchestrationAdapter, 'getInstance'>;
  entitlement: Pick<EntitlementService, 'assertLabAccess'>;
  check: Pick<LabCheckService, 'evaluate' | 'runSetup' | 'readHistoryCount'>;
  award: Pick<AwardService, 'withUserLock' | 'apply' | 'balance'>;
  activity: Pick<ActivityLogService, 'recordEvent'>;
  progress: Pick<typeof progressCompletionHooks, 'completeLabItems' | 'afterCommit'>;
  gamification: Pick<GamificationService, 'afterLearningEvent'>;
  redis: Pick<typeof redisClient, 'set' | 'eval'>;
}

function defaultDeps(): LabStepServiceDeps {
  return {
    repo: labsRepository,
    orchestration: containerOrchestrationAdapter,
    entitlement: entitlementService,
    check: labCheckService,
    award: awardService,
    activity: activityLogService,
    progress: progressCompletionHooks,
    gamification: gamificationService,
    redis: redisClient,
  };
}

/** Loaded lab: active, accessible, with a runnable v2 spec. */
interface LabContext {
  lab: LabRow;
  spec: LabSpecV2;
  multiplier: number;
}

/** Progress derived from one set of LAB_* activity rows. */
interface LabProgress {
  /** stepId -> time of the first LAB_STEP_PASSED. */
  passedAt: Map<string, Date>;
  /** stepId -> hint ids revealed for that step. */
  revealedHintIds: Map<string, Set<string>>;
  /** `${instanceId}:${stepId}` for every LAB_STEP_STAGED record. */
  stagedKeys: Set<string>;
  completedAt: Date | null;
}

/** One lab-scoped ledger row, decoded from its `[k:...]` description prefix. */
interface LabLedgerEntry {
  key: string;
  kind: AwardKind;
  pointsChange: number;
}

function labNotFound(): NotFoundError {
  return new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
}

function environmentUnreachable(): AppError {
  return new AppError('The lab environment is unreachable. Please try again.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
    { code: ERROR_CODES.LAB_ENV_UNREACHABLE },
  ]);
}

function stepNotFound(): NotFoundError {
  return new NotFoundError('Step not found.', [{ code: ERROR_CODES.STEP_NOT_FOUND }]);
}

function findStep(spec: LabSpecV2, stepId: string): LabStepV2 {
  const step = spec.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw stepNotFound();
  }
  return step;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildProgress(rows: LabActivityRow[]): LabProgress {
  const progress: LabProgress = {
    passedAt: new Map(),
    revealedHintIds: new Map(),
    stagedKeys: new Set(),
    completedAt: null,
  };
  for (const row of rows) {
    const details = row.details ?? {};
    const stepId = readString(details.stepId);
    switch (row.activityType) {
      case 'LAB_STEP_PASSED':
        if (stepId && !progress.passedAt.has(stepId)) {
          progress.passedAt.set(stepId, row.createdAt);
        }
        break;
      case 'LAB_HINT_REVEALED': {
        const hintId = readString(details.hintId);
        if (stepId && hintId) {
          const revealed = progress.revealedHintIds.get(stepId) ?? new Set<string>();
          revealed.add(hintId);
          progress.revealedHintIds.set(stepId, revealed);
        }
        break;
      }
      case 'LAB_STEP_STAGED': {
        const instanceId = readNumber(details.instanceId);
        if (stepId && instanceId !== null) {
          progress.stagedKeys.add(`${instanceId}:${stepId}`);
        }
        break;
      }
      case 'LAB_COMPLETED':
        progress.completedAt ??= row.createdAt;
        break;
      default:
        break;
    }
  }
  return progress;
}

/** Status of every step: passed, the first unpassed step is current, the rest are locked. */
function computeStatuses(steps: LabStepV2[], passedAt: Map<string, Date>): Map<string, LabStepStatus> {
  const statuses = new Map<string, LabStepStatus>();
  let currentFound = false;
  for (const step of steps) {
    if (passedAt.has(step.id)) {
      statuses.set(step.id, 'passed');
    } else if (!currentFound) {
      statuses.set(step.id, 'current');
      currentFound = true;
    } else {
      statuses.set(step.id, 'locked');
    }
  }
  return statuses;
}

function assertCurrentStep(status: LabStepStatus): void {
  if (status === 'passed') {
    throw new ConflictError('This step is already passed.', [{ code: ERROR_CODES.STEP_ALREADY_PASSED }]);
  }
  if (status === 'locked') {
    throw new ConflictError('Complete the current step first.', [{ code: ERROR_CODES.STEP_LOCKED }]);
  }
}

function resultMessage(reason: LabStepCheckReason): string {
  switch (reason) {
    case 'passed':
      return 'Step passed.';
    case 'timeout':
      return 'The check timed out. Make sure long running commands have finished.';
    case 'wrong_answer':
      return 'That answer is not correct.';
    case 'not_passed':
      return 'Not complete yet. Review the step and try again.';
  }
}

function requiresStage(step: LabStepV2): boolean {
  return step.setup.length > 0 || step.kind === 'question';
}

function nextUnpassedStepId(steps: LabStepV2[], passedAt: Map<string, Date>): string | null {
  return steps.find((step) => !passedAt.has(step.id))?.id ?? null;
}

/** Sum of a row's `pointsChange` converted to a positive magnitude. */
function magnitude(pointsChange: number): number {
  return Math.abs(pointsChange);
}

function countUnrevealed(step: LabStepV2, revealed: Set<string>): number {
  return step.hints.filter((hint) => !revealed.has(hint.id)).length;
}

interface Evaluation {
  passed: boolean;
  reason: LabStepCheckReason;
  guessed: boolean;
}

/** Result of the locked unit of a check: what was written and the state it left behind. */
interface LockedCheckOutcome {
  alreadyPassed: boolean;
  delta: number;
  pointsAwarded: number;
  penalties: { wrongAnswer: number; guess: number };
  completion: LabStepCheckResultDto['completion'];
  completedLessonIds: number[];
  passedNow: boolean;
  evaluation: Evaluation;
  balance: number;
  completedAt: Date | null;
  passedAt: Map<string, Date>;
}

/** A hint can be revealed on a current or passed step only. */
function assertRevealable(status: LabStepStatus): void {
  if (status === 'locked') {
    throw new ConflictError('Complete the current step first.', [{ code: ERROR_CODES.STEP_LOCKED }]);
  }
}

export class LabStepService {
  constructor(private readonly deps: LabStepServiceDeps = defaultDeps()) {}

  /* ── State (GET /labs/:labId/steps) ───────────────────────────────────── */

  async getState(userId: number, labId: number): Promise<LabStepsStateDto> {
    const { lab, spec, multiplier } = await this.loadLab(userId, labId);
    const progress = buildProgress(
      await this.deps.repo.listLabActivity(userId, labId, STATE_EVENT_TYPES),
    );
    const ledger = await this.readLabLedger(userId, labId);
    const statuses = computeStatuses(spec.steps, progress.passedAt);

    const anyActive = await this.deps.repo.findAnyActiveInstanceForUser(userId);
    let activeInstance: LabStepsStateDto['activeInstance'] = null;
    let otherActiveInstance: LabStepsStateDto['otherActiveInstance'] = null;
    if (anyActive && anyActive.labId === labId) {
      activeInstance = await this.toActiveInstance(anyActive);
    } else if (anyActive && anyActive.labId !== null) {
      const otherLab = await this.deps.repo.findLabById(anyActive.labId);
      otherActiveInstance = {
        instanceId: anyActive.instanceId,
        labId: anyActive.labId,
        labName: otherLab?.labName ?? 'Lab',
      };
    }

    const steps: LearnerLabStepDto[] = spec.steps.map((step, index) => {
      const status = statuses.get(step.id) ?? 'locked';
      const revealedIds = progress.revealedHintIds.get(step.id) ?? new Set<string>();
      const nextHintIndex = step.hints.findIndex((hint) => !revealedIds.has(hint.id));
      const isQuestion = step.kind === 'question';
      return {
        stepId: step.id,
        position: index + 1,
        title: step.title,
        kind: step.kind,
        status,
        instructions: status === 'locked' ? null : step.instructions,
        points: scalePoints(step.points, multiplier),
        pointsAwarded: ledger.find((entry) => entry.key === awardKeys.labStep(labId, step.id))?.pointsChange ?? 0,
        passedAt: progress.passedAt.get(step.id)?.toISOString() ?? null,
        requiresStage: requiresStage(step),
        stagedOnInstanceId:
          activeInstance && progress.stagedKeys.has(`${activeInstance.instanceId}:${step.id}`)
            ? activeInstance.instanceId
            : null,
        hints: {
          total: step.hints.length,
          revealed: step.hints.flatMap((hint, hintIndex) =>
            revealedIds.has(hint.id) ? [{ hintIndex, text: hint.text }] : [],
          ),
          nextHintIndex: nextHintIndex === -1 ? null : nextHintIndex,
          cost: step.hintCost,
        },
        penalties: isQuestion
          ? { wrongAnswer: step.wrongPenalty, guess: step.guessPenalty }
          : { wrongAnswer: 0, guess: 0 },
      };
    });

    const completionBonus = scalePoints(spec.completionBonus, multiplier);
    const stepPointsTotal = steps.reduce((sum, step) => sum + step.points, 0);
    const totals = {
      pointsAvailable: stepPointsTotal + completionBonus,
      pointsEarned: 0,
      hintPenalties: 0,
      wrongAnswerPenalties: 0,
      guessPenalties: 0,
    };
    for (const entry of ledger) {
      if (entry.kind === 'lab_step' || entry.kind === 'lab_done') {
        totals.pointsEarned += entry.pointsChange;
      } else if (entry.kind === 'lab_hint') {
        totals.hintPenalties += magnitude(entry.pointsChange);
      } else if (entry.kind === 'lab_wrong') {
        totals.wrongAnswerPenalties += magnitude(entry.pointsChange);
      } else if (entry.kind === 'lab_guess') {
        totals.guessPenalties += magnitude(entry.pointsChange);
      }
    }

    return {
      labId: lab.labId,
      slug: lab.slug,
      labName: lab.labName,
      mode: spec.mode,
      scenarioIntro: spec.scenario.intro,
      steps,
      currentStepId: spec.steps.find((step) => statuses.get(step.id) === 'current')?.id ?? null,
      completedAt: progress.completedAt?.toISOString() ?? null,
      completionBonus,
      totals,
      activeInstance,
      otherActiveInstance,
    };
  }

  /* ── Stage (POST /labs/instances/:instanceId/steps/:stepId/stage) ─────── */

  async stage(userId: number, instanceId: number, stepId: string): Promise<LabStepStageResultDto> {
    const { labId } = await this.loadRunningInstance(userId, instanceId);
    const { spec } = await this.loadLab(userId, labId);
    const step = findStep(spec, stepId);

    const progress = buildProgress(await this.deps.repo.listLabActivity(userId, labId, STATE_EVENT_TYPES));
    assertCurrentStep(computeStatuses(spec.steps, progress.passedAt).get(step.id) ?? 'locked');

    const existing = await this.deps.repo.findLatestStageRecord(userId, instanceId, step.id);
    if (existing) {
      return this.toStageResult(step.id, instanceId, existing, false);
    }
    return this.runStage(userId, instanceId, labId, spec, step);
  }

  /** Runs setup under the Redis mutex, then records the stage under the user lock. */
  private async runStage(
    userId: number,
    instanceId: number,
    labId: number,
    spec: LabSpecV2,
    step: LabStepV2,
  ): Promise<LabStepStageResultDto> {
    const ids = { userId, labId, instanceId, stepId: step.id };
    const token = randomUUID();
    const lockKey = `lock:stage:lab:${instanceId}:${step.id}`;

    let acquired: 'OK' | null;
    try {
      acquired = await this.deps.redis.set(lockKey, token, 'PX', STAGE_LOCK_TTL_MS, 'NX');
    } catch {
      logger.error(ids, 'Stage mutex unavailable');
      throw environmentUnreachable();
    }
    if (acquired !== 'OK') {
      throw new ConflictError('This step is already being staged. Try again in a moment.', [
        { code: ERROR_CODES.STEP_STAGE_IN_PROGRESS },
      ]);
    }

    try {
      const recheck = await this.deps.repo.findLatestStageRecord(userId, instanceId, step.id);
      if (recheck) {
        return this.toStageResult(step.id, instanceId, recheck, false);
      }

      let setupRan = false;
      if (step.setup.length > 0) {
        await this.guarded(ids, () => this.deps.check.runSetup(instanceId, step.setup));
        setupRan = true;
      }
      const historyCount = await this.guarded(ids, () => this.deps.check.readHistoryCount(instanceId));

      return await this.deps.award.withUserLock(userId, async (tx) => {
        const progress = buildProgress(await this.deps.repo.listLabActivity(userId, labId, STATE_EVENT_TYPES, tx));
        assertCurrentStep(computeStatuses(spec.steps, progress.passedAt).get(step.id) ?? 'locked');

        const stored = await this.deps.repo.findLatestStageRecord(userId, instanceId, step.id, tx);
        if (stored) {
          return this.toStageResult(step.id, instanceId, stored, false);
        }
        const stagedAt = new Date().toISOString();
        await this.deps.activity.recordEvent(
          userId,
          'LAB_STEP_STAGED',
          { labId, stepId: step.id, instanceId, historyCount, stagedAt },
          tx,
        );
        return { stepId: step.id, instanceId, stagedAt, setupRan };
      });
    } finally {
      await this.releaseStageLock(lockKey, token, ids);
    }
  }

  private async releaseStageLock(
    lockKey: string,
    token: string,
    ids: Record<string, number | string>,
  ): Promise<void> {
    try {
      await this.deps.redis.eval(RELEASE_STAGE_LOCK_SCRIPT, 1, lockKey, token);
    } catch {
      logger.warn(ids, 'Stage mutex release failed; it expires on its own');
    }
  }

  /* ── Check (POST /labs/instances/:instanceId/steps/:stepId/check) ─────── */

  async check(
    userId: number,
    instanceId: number,
    stepId: string,
    answer?: string,
  ): Promise<LabStepCheckResultDto> {
    const { instance, labId } = await this.loadRunningInstance(userId, instanceId);
    const { lab, spec, multiplier } = await this.loadLab(userId, labId);
    const step = findStep(spec, stepId);
    const ids = { userId, labId, instanceId, stepId: step.id };

    const progress = buildProgress(await this.deps.repo.listLabActivity(userId, labId, STATE_EVENT_TYPES));
    const status = computeStatuses(spec.steps, progress.passedAt).get(step.id) ?? 'locked';
    if (status === 'locked') {
      throw new ConflictError('Complete the current step first.', [{ code: ERROR_CODES.STEP_LOCKED }]);
    }

    // Practice re-check of a passed question step: nothing is evaluated, so an answer cannot be practised for free.
    if (status === 'passed' && step.kind === 'question') {
      return this.alreadyPassedResult(userId, step.id, true, 'passed', progress, spec);
    }

    let stagedHistoryCount = 0;
    if (requiresStage(step)) {
      const stage = await this.deps.repo.findLatestStageRecord(userId, instanceId, step.id);
      if (!stage) {
        throw new ConflictError('Stage this step before checking it.', [{ code: ERROR_CODES.STEP_NOT_STAGED }]);
      }
      stagedHistoryCount = readNumber(stage.details?.historyCount) ?? 0;
    }
    if (step.kind === 'question' && answer === undefined) {
      throw new ValidationError('Enter an answer to check this step.', [{ code: ERROR_CODES.ANSWER_REQUIRED }]);
    }

    const evaluation = await this.evaluate(instanceId, step, answer, stagedHistoryCount, ids);

    if (status === 'passed') {
      // Practice re-check of a passed task step: the outcome is reported, nothing is written.
      return this.alreadyPassedResult(userId, step.id, evaluation.passed, evaluation.reason, progress, spec);
    }

    const startedAt = evaluation.passed
      ? await this.deps.repo.findLabStartTime(userId, instanceId)
      : null;
    const timeTakenSeconds = startedAt ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) : null;

    const outcome = await this.deps.award.withUserLock(userId, async (tx): Promise<LockedCheckOutcome> => {
      const locked = buildProgress(await this.deps.repo.listLabActivity(userId, labId, PASS_EVENT_TYPES, tx));
      if (locked.passedAt.has(step.id)) {
        // A concurrent request passed the step first: report it, write nothing.
        return {
          alreadyPassed: true,
          delta: 0,
          pointsAwarded: 0,
          penalties: { wrongAnswer: 0, guess: 0 },
          completion: null,
          completedLessonIds: [],
          passedNow: false,
          evaluation: { passed: true, reason: 'passed', guessed: false },
          balance: await this.deps.award.balance(tx, userId),
          completedAt: locked.completedAt,
          passedAt: locked.passedAt,
        };
      }

      if (!evaluation.passed) {
        const failed = await this.deps.repo.insertActivity(
          {
            userId,
            activityType: 'LAB_STEP_FAILED',
            details: { labId, stepId: step.id, instanceId, reason: evaluation.reason, guessed: evaluation.guessed },
          },
          tx,
        );
        let delta = 0;
        const penalties = { wrongAnswer: 0, guess: 0 };
        if (step.kind === 'question') {
          const wrong = await this.deps.award.apply(tx, {
            userId,
            key: awardKeys.labWrong(labId, step.id, failed),
            points: -step.wrongPenalty,
            sourceType: 'penalty',
            sourceId: labId,
            label: `Wrong answer: ${step.title}`,
          });
          delta += wrong.pointsChange;
          penalties.wrongAnswer = magnitude(wrong.pointsChange);
          if (evaluation.guessed) {
            const guess = await this.deps.award.apply(tx, {
              userId,
              key: awardKeys.labGuess(labId, step.id, failed),
              points: -step.guessPenalty,
              sourceType: 'penalty',
              sourceId: labId,
              label: `Guess penalty: ${step.title}`,
            });
            delta += guess.pointsChange;
            penalties.guess = magnitude(guess.pointsChange);
          }
        }
        return {
          alreadyPassed: false,
          delta,
          pointsAwarded: 0,
          penalties,
          completion: null,
          completedLessonIds: [],
          passedNow: false,
          evaluation,
          balance: await this.deps.award.balance(tx, userId),
          completedAt: locked.completedAt,
          passedAt: locked.passedAt,
        };
      }

      const nowIso = new Date().toISOString();
      const passedLog = await this.deps.repo.insertActivity(
        {
          userId,
          activityType: 'LAB_STEP_PASSED',
          details: {
            labId,
            stepId: step.id,
            instanceId,
            points: scalePoints(step.points, multiplier),
            passedAt: nowIso,
          },
        },
        tx,
      );
      let delta = 0;
      const penalties = { wrongAnswer: 0, guess: 0 };
      const stepAward = await this.deps.award.apply(tx, {
        userId,
        key: awardKeys.labStep(labId, step.id),
        points: scalePoints(step.points, multiplier),
        sourceType: 'lab_complete',
        sourceId: labId,
        label: `Step passed: ${step.title}`,
      });
      delta += stepAward.pointsChange;
      if (evaluation.guessed) {
        const guess = await this.deps.award.apply(tx, {
          userId,
          key: awardKeys.labGuess(labId, step.id, passedLog),
          points: -step.guessPenalty,
          sourceType: 'penalty',
          sourceId: labId,
          label: `Guess penalty: ${step.title}`,
        });
        delta += guess.pointsChange;
        penalties.guess = magnitude(guess.pointsChange);
      }

      const passedAt = new Map(locked.passedAt);
      passedAt.set(step.id, new Date(nowIso));
      let completion: LabStepCheckResultDto['completion'] = null;
      let completedLessonIds: number[] = [];
      let completedAt = locked.completedAt;
      const allPassed = spec.steps.every((candidate) => passedAt.has(candidate.id));
      if (allPassed && completedAt === null) {
        // Completed labs stay complete: the bonus is paid once, even if steps are added later.
        const completionBonus = scalePoints(spec.completionBonus, multiplier);
        const pointsAvailable = spec.steps.reduce(
          (sum, candidate) => sum + scalePoints(candidate.points, multiplier),
          0,
        ) + completionBonus;
        const completedIso = new Date().toISOString();
        await this.deps.repo.insertActivity(
          {
            userId,
            activityType: 'LAB_COMPLETED',
            details: {
              labId,
              labType: instance.labType,
              instanceId,
              passedAt: completedIso,
              timeTakenSeconds,
              pointsEarned: pointsAvailable,
            },
          },
          tx,
        );
        const bonus = await this.deps.award.apply(tx, {
          userId,
          key: awardKeys.labDone(labId),
          points: completionBonus,
          sourceType: 'lab_complete',
          sourceId: labId,
          label: `Lab completed: ${lab.labName}`,
        });
        delta += bonus.pointsChange;
        completedLessonIds = await this.deps.progress.completeLabItems(tx, userId, labId);
        completedAt = new Date(completedIso);
        completion = { completedAt: completedIso, completionBonus, completedLessonIds };
      }

      return {
        alreadyPassed: false,
        delta,
        pointsAwarded: stepAward.pointsChange,
        penalties,
        completion,
        completedLessonIds,
        passedNow: true,
        evaluation,
        balance: await this.deps.award.balance(tx, userId),
        completedAt,
        passedAt,
      };
    });

    if (outcome.passedNow) {
      if (outcome.completion) {
        await this.expireAfterCompletion(instanceId, ids);
      }
      await this.deps.progress.afterCommit(userId, outcome.completedLessonIds);
      void this.deps.gamification.afterLearningEvent(userId).catch(() => {
        logger.error({ userId, labId, stepId: step.id }, 'Gamification update after lab step failed');
      });
    }

    const reason: LabStepCheckReason = outcome.alreadyPassed ? 'passed' : outcome.evaluation.reason;
    const passed = outcome.alreadyPassed ? true : outcome.evaluation.passed;
    return {
      stepId: step.id,
      passed,
      alreadyPassed: outcome.alreadyPassed,
      reason,
      message: outcome.alreadyPassed ? 'This step is already passed. Nothing was recorded.' : resultMessage(reason),
      guessed: outcome.evaluation.guessed,
      pointsAwarded: outcome.pointsAwarded,
      penalties: outcome.penalties,
      nextStepId: nextUnpassedStepId(spec.steps, outcome.passedAt),
      labCompleted: outcome.completedAt !== null,
      completion: outcome.completion,
      xp: { delta: outcome.delta, balance: outcome.balance },
    };
  }

  /** Runs the step's check (task) or compares the answer (question) outside the user lock. */
  private async evaluate(
    instanceId: number,
    step: LabStepV2,
    answer: string | undefined,
    stagedHistoryCount: number,
    ids: Record<string, number | string>,
  ): Promise<Evaluation> {
    if (step.kind === 'task') {
      const check = step.check;
      if (!check) {
        logger.error(ids, 'Task step has no check');
        throw new AppError('This lab is misconfigured.', HTTP_STATUS.CONFLICT, [{ code: ERROR_CODES.LAB_MISCONFIGURED }]);
      }
      const outcome = await this.guarded(ids, () => this.deps.check.evaluate(instanceId, check));
      return { passed: outcome.passed, reason: outcome.reason, guessed: false };
    }

    const config = step.answer;
    if (!config || answer === undefined) {
      logger.error(ids, 'Question step has no accepted answers');
      throw new AppError('This lab is misconfigured.', HTTP_STATUS.CONFLICT, [{ code: ERROR_CODES.LAB_MISCONFIGURED }]);
    }
    const historyCount = await this.guarded(ids, () => this.deps.check.readHistoryCount(instanceId));
    const guessed = historyCount <= stagedHistoryCount;
    const submitted = normalizeAnswer(answer, config.normalize);
    const passed = config.accepted.some((accepted) => normalizeAnswer(accepted, config.normalize) === submitted);
    return { passed, reason: passed ? 'passed' : 'wrong_answer', guessed };
  }

  /** Orchestrator and exec failures surface as 503 LAB_ENV_UNREACHABLE; nothing is recorded. */
  private async guarded<T>(ids: Record<string, number | string>, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error(ids, 'Lab environment call failed');
      throw environmentUnreachable();
    }
  }

  /** Response for a check on a step that already passed: no writes, no award, no penalty. */
  private async alreadyPassedResult(
    userId: number,
    stepId: string,
    passed: boolean,
    reason: LabStepCheckReason,
    progress: LabProgress,
    spec: LabSpecV2,
  ): Promise<LabStepCheckResultDto> {
    return {
      stepId,
      passed,
      alreadyPassed: true,
      reason,
      message: 'This step is already passed. Nothing was recorded.',
      guessed: false,
      pointsAwarded: 0,
      penalties: { wrongAnswer: 0, guess: 0 },
      nextStepId: nextUnpassedStepId(spec.steps, progress.passedAt),
      labCompleted: progress.completedAt !== null,
      completion: null,
      xp: { delta: 0, balance: await this.latestBalance(userId) },
    };
  }

  /** Grace period after completion so the TTL monitor reaps the instance; failure is logged, not thrown. */
  private async expireAfterCompletion(instanceId: number, ids: Record<string, number | string>): Promise<void> {
    try {
      await this.deps.repo.updateInstanceExpiry(
        instanceId,
        new Date(Date.now() + COMPLETED_GRACE_MINUTES * 60_000),
      );
    } catch {
      logger.error(ids, 'Could not shorten the instance after lab completion');
    }
  }

  /* ── Hint reveal (POST /labs/:labId/steps/:stepId/hints/:hintIndex/reveal) ─ */

  async revealHint(
    userId: number,
    labId: number,
    stepId: string,
    hintIndex: number,
  ): Promise<HintRevealResultDto> {
    const { spec } = await this.loadLab(userId, labId);
    const step = findStep(spec, stepId);
    if (hintIndex >= step.hints.length) {
      throw new NotFoundError('Hint not found.', [{ code: ERROR_CODES.HINT_NOT_FOUND }]);
    }
    const hint = step.hints[hintIndex];

    return this.deps.award.withUserLock(userId, async (tx) => {
      const progress = buildProgress(await this.deps.repo.listLabActivity(userId, labId, HINT_EVENT_TYPES, tx));
      assertRevealable(computeStatuses(spec.steps, progress.passedAt).get(step.id) ?? 'locked');

      const revealed = progress.revealedHintIds.get(step.id) ?? new Set<string>();
      if (revealed.has(hint.id)) {
        return {
          stepId: step.id,
          hintIndex,
          text: hint.text,
          alreadyRevealed: true,
          penaltyApplied: 0,
          remaining: countUnrevealed(step, revealed),
          xp: { delta: 0, balance: await this.deps.award.balance(tx, userId) },
        };
      }

      const nextIndex = step.hints.findIndex((candidate) => !revealed.has(candidate.id));
      if (nextIndex !== hintIndex) {
        throw new ConflictError('Reveal the earlier hints first.', [{ code: ERROR_CODES.HINT_OUT_OF_ORDER }]);
      }

      await this.deps.activity.recordEvent(
        userId,
        'LAB_HINT_REVEALED',
        { labId, stepId: step.id, hintId: hint.id, hintIndex, penalty: step.hintCost },
        tx,
      );
      const penalty = await this.deps.award.apply(tx, {
        userId,
        key: awardKeys.labHint(labId, step.id, hint.id),
        points: -step.hintCost,
        sourceType: 'penalty',
        sourceId: labId,
        label: `Hint revealed: ${step.title}`,
      });
      const revealedAfter = new Set(revealed);
      revealedAfter.add(hint.id);
      return {
        stepId: step.id,
        hintIndex,
        text: hint.text,
        alreadyRevealed: false,
        penaltyApplied: magnitude(penalty.pointsChange),
        remaining: countUnrevealed(step, revealedAfter),
        xp: { delta: penalty.pointsChange, balance: await this.deps.award.balance(tx, userId) },
      };
    });
  }

  /* ── Shared loaders and readers ───────────────────────────────────────── */

  /** Active lab with a runnable v2 spec and the learner's entitlement. Runs outside the user lock. */
  private async loadLab(userId: number, labId: number): Promise<LabContext> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || !lab.isActive) {
      throw labNotFound();
    }
    await this.deps.entitlement.assertLabAccess(userId, labId);

    const proLab = await this.deps.repo.findProLabByLabId(labId);
    const parsed = parseLabSpec(proLab ? proLab.flagValues : null);
    if (parsed.kind === 'invalid') {
      logger.error({ labId, issues: parsed.issues }, 'Stored lab spec failed validation');
      throw new ConflictError('This lab is misconfigured.', [{ code: ERROR_CODES.LAB_MISCONFIGURED }]);
    }
    if (parsed.kind !== 'v2') {
      throw new ConflictError('This lab is not ready yet.', [{ code: ERROR_CODES.LAB_NOT_READY }]);
    }
    const multiplier = await this.deps.repo.getPointsMultiplier(labId);
    return { lab, spec: parsed.spec, multiplier };
  }

  /** Running instance owned by the learner. The lab is resolved from the instance, never from the URL. */
  private async loadRunningInstance(
    userId: number,
    instanceId: number,
  ): Promise<{ instance: InstanceRow; labId: number }> {
    const instance = await this.deps.repo.findInstanceForUser(userId, instanceId);
    if (!instance || instance.labId === null) {
      throw new NotFoundError('Lab instance not found.', [{ code: ERROR_CODES.INSTANCE_NOT_FOUND }]);
    }
    if (instance.status !== 'running') {
      throw new ConflictError('The lab instance is not running.', [{ code: ERROR_CODES.INSTANCE_NOT_RUNNING }]);
    }
    return { instance, labId: instance.labId };
  }

  /** Lab-scoped ledger rows of the learner, decoded from the `[k:...]` description prefix. Plain reads, no lock. */
  private async readLabLedger(userId: number, labId: number): Promise<LabLedgerEntry[]> {
    const rows = await db
      .select({ description: pointsHistory.description, pointsChange: pointsHistory.pointsChange })
      .from(pointsHistory)
      .where(
        and(
          eq(pointsHistory.userId, userId),
          sql`${pointsHistory.description} COLLATE utf8mb4_bin LIKE ${`${escapeLike('[k:lab_')}%`} ESCAPE '!'`,
        ),
      );
    const entries: LabLedgerEntry[] = [];
    for (const row of rows) {
      const parsed = parseAwardKey(row.description);
      if (!parsed.key || !LAB_AWARD_KINDS.has(parsed.kind)) {
        continue;
      }
      if (parsed.key.split(':')[1] !== String(labId)) {
        continue;
      }
      entries.push({ key: parsed.key, kind: parsed.kind, pointsChange: row.pointsChange });
    }
    return entries;
  }

  /** Current running balance (latest ledger row), read without the lock for no-write responses. */
  private async latestBalance(userId: number): Promise<number> {
    const rows = await db
      .select({ balance: pointsHistory.pointsBalanceAfter })
      .from(pointsHistory)
      .where(eq(pointsHistory.userId, userId))
      .orderBy(desc(pointsHistory.historyId))
      .limit(1);
    return rows[0]?.balance ?? 0;
  }

  private async toActiveInstance(row: InstanceRow): Promise<NonNullable<LabStepsStateDto['activeInstance']>> {
    let terminalWsUrl: string | null = null;
    try {
      const endpoint = await this.deps.orchestration.getInstance(row.instanceId);
      terminalWsUrl = endpoint?.terminalWsUrl ?? null;
    } catch {
      logger.warn({ instanceId: row.instanceId }, 'Could not resolve terminal endpoint from orchestrator');
    }
    return {
      instanceId: row.instanceId,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      terminalWsUrl,
    };
  }

  private toStageResult(
    stepId: string,
    instanceId: number,
    record: LabActivityRow,
    setupRan: boolean,
  ): LabStepStageResultDto {
    return {
      stepId,
      instanceId,
      stagedAt: readString(record.details?.stagedAt) ?? record.createdAt.toISOString(),
      setupRan,
    };
  }
}

export const labStepService = new LabStepService();
