import { AppError, ERROR_CODES } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import type { LabAnswerNormalize, LabNumericOp, LabStepCheck, LabStepExpect } from '../dto/lab-spec.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';

/**
 * Lab step evaluation against a running learner environment (contracts 2.1,
 * 4.1). Check commands, setup commands and their output never leave the
 * server: only `passed` and `reason` reach the learner.
 */

/** Counts shell history lines across root and every home directory (guess detection, contracts 4.1). */
export const HISTORY_COUNT_COMMAND = 'cat /root/.bash_history /home/*/.bash_history 2>/dev/null | wc -l';

/** Total budget for all setup commands of one stage (contracts 4.1). */
const SETUP_TOTAL_BUDGET_MS = 60_000;
/** Per setup command ceiling; the remaining total budget caps it further. */
const SETUP_COMMAND_TIMEOUT_MS = 30_000;

export interface CheckOutcome {
  passed: boolean;
  reason: 'passed' | 'not_passed' | 'timeout';
  exitCode: number | null;
  statusCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface LabCheckServiceDeps {
  orchestration: Pick<ContainerOrchestrationAdapter, 'executeCommand' | 'probeHttp'>;
}

function defaultDeps(): LabCheckServiceDeps {
  return { orchestration: containerOrchestrationAdapter };
}

function environmentUnreachable(): AppError {
  return new AppError('The lab environment is unreachable. Please try again.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
    { code: ERROR_CODES.LAB_ENV_UNREACHABLE },
  ]);
}

/** Single-quote a path for the shell: each `'` becomes `'\''`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function compareNumeric(actual: number, op: LabNumericOp, expected: number): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
  }
}

/** Content matchers run on the trimmed stdout. `exitCode` is not a content matcher. */
function matchesContent(content: string, expect: LabStepExpect): boolean {
  switch (expect.mode) {
    case 'exitCode':
      return false;
    case 'exact':
      return content === expect.value;
    case 'contains':
      return content.includes(expect.value);
    case 'regex': {
      try {
        return new RegExp(expect.value, 'm').test(content);
      } catch {
        return false;
      }
    }
    case 'numeric': {
      const value = Number(content);
      return Number.isFinite(value) && compareNumeric(value, expect.op, expect.value);
    }
  }
}

export class LabCheckService {
  constructor(private readonly deps: LabCheckServiceDeps = defaultDeps()) {}

  /** Runs one step check on the instance. Orchestrator failures propagate as 503 (nothing is recorded). */
  async evaluate(instanceId: number, check: LabStepCheck): Promise<CheckOutcome> {
    const startedAt = Date.now();
    const { orchestration } = this.deps;

    if (check.type === 'http') {
      const probe = await orchestration.probeHttp(instanceId, {
        path: check.path,
        port: check.port,
        timeoutMs: check.timeoutMs,
      });
      const passed = compareNumeric(probe.statusCode, check.expect.op, check.expect.value);
      return {
        passed,
        reason: passed ? 'passed' : 'not_passed',
        exitCode: null,
        statusCode: probe.statusCode,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt,
      };
    }

    let command: string;
    if (check.type === 'file') {
      command =
        check.expect.mode === 'exitCode'
          ? `test -e ${shellQuote(check.path)}`
          : `cat -- ${shellQuote(check.path)}`;
    } else {
      command = check.command;
    }

    const result = await orchestration.executeCommand(instanceId, command, { timeoutMs: check.timeoutMs });
    const base = {
      exitCode: result.exitCode,
      statusCode: null,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
    if (result.timedOut) {
      return { ...base, passed: false, reason: 'timeout' };
    }

    let passed: boolean;
    if (check.type === 'command') {
      passed = result.exitCode === check.expect.value;
    } else if (check.type === 'output') {
      passed = result.exitCode === 0 && matchesContent(result.stdout.trim(), check.expect);
    } else if (check.expect.mode === 'exitCode') {
      passed = result.exitCode === check.expect.value;
    } else {
      passed = result.exitCode === 0 && matchesContent(result.stdout.trim(), check.expect);
    }
    return { ...base, passed, reason: passed ? 'passed' : 'not_passed' };
  }

  /**
   * Runs setup commands in order under one 60 s budget. A non-zero exit,
   * a timeout or an exhausted budget throws 503 LAB_ENV_UNREACHABLE. Only the
   * instance id and command index are logged, never the command text.
   */
  async runSetup(instanceId: number, commands: string[]): Promise<void> {
    const startedAt = Date.now();
    for (let index = 0; index < commands.length; index += 1) {
      const remaining = SETUP_TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        logger.error({ instanceId, commandIndex: index }, 'Lab setup budget exhausted');
        throw environmentUnreachable();
      }
      const result = await this.deps.orchestration.executeCommand(instanceId, commands[index], {
        timeoutMs: Math.min(SETUP_COMMAND_TIMEOUT_MS, remaining),
      });
      if (result.timedOut || result.exitCode !== 0) {
        logger.error(
          { instanceId, commandIndex: index, timedOut: result.timedOut, exitCode: result.exitCode },
          'Lab setup command failed',
        );
        throw environmentUnreachable();
      }
    }
  }

  /**
   * Current shell history line count. Unparseable output counts as 0; an
   * exec failure or timeout throws 503 because the guess check depends on it.
   */
  async readHistoryCount(instanceId: number): Promise<number> {
    const result = await this.deps.orchestration.executeCommand(instanceId, HISTORY_COUNT_COMMAND);
    if (result.timedOut) {
      throw environmentUnreachable();
    }
    const count = parseInt(result.stdout.trim(), 10);
    return Number.isNaN(count) ? 0 : count;
  }
}

export const labCheckService = new LabCheckService();

/** Learner answer normalization for question steps (contracts 2.1). */
export function normalizeAnswer(value: string, mode: LabAnswerNormalize): string {
  switch (mode) {
    case 'none':
      return value;
    case 'trim':
      return value.trim();
    case 'trim_lower':
      return value.trim().toLowerCase();
    case 'collapse_ws_lower':
      return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}

/** Positive awards scale by the difficulty multiplier (contracts 11.3); penalties are never scaled. */
export function scalePoints(points: number, multiplier: number): number {
  return Math.max(0, Math.round(points * multiplier));
}
