import { AppError, ConflictError, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { activityLogService } from '../../progress/services/ActivityLogService';
import { resolveAssertionGroup } from '../config/assertion-registry';
import type { LabCompletionEvent } from '../dto/labs.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { InstanceRow, LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

/** Grace period after completion so the TTL monitor reaps the instance. */
const COMPLETED_GRACE_MINUTES = 5;

export interface AssertionServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'findProLabByLabId'
    | 'findInstanceForUser'
    | 'updateInstanceExpiry'
    | 'hasLabCompletionEvent'
    | 'findLabStartTime'
  >;
  orchestration: Pick<ContainerOrchestrationAdapter, 'executeCommand' | 'probeHttp'>;
}

function defaultDeps(): AssertionServiceDeps {
  return { repo: labsRepository, orchestration: containerOrchestrationAdapter };
}

/**
 * F6 §06 §07 assertion engine: runs each checkpoint's assertion group from
 * the registry against the learner's instance, returns PASS/FAIL with
 * user-safe hints only (never raw output), and on full PASS writes the
 * LAB_COMPLETED activity event (the F5 progress injection point) plus a
 * short TTL so the monitor terminates the instance.
 */
export class AssertionService {
  constructor(private readonly deps: AssertionServiceDeps = defaultDeps()) {}

  async runChecks(
    userId: number,
    instanceId: number,
  ): Promise<{
    instanceId: number;
    assertions: Array<{ name: string; passed: boolean; message: string | null }>;
    allPassed: boolean;
    completedAt: string | null;
  }> {
    const instance = await this.deps.repo.findInstanceForUser(userId, instanceId);
    if (!instance || !instance.labId) {
      throw new NotFoundError('Lab instance not found.');
    }
    if (instance.status !== 'running') {
      throw new ConflictError('The lab instance must be running before running checks.');
    }
    if (await this.deps.repo.hasLabCompletionEvent(userId, instance.labId)) {
      throw new ConflictError('This lab has already been completed.');
    }

    const proLab = await this.deps.repo.findProLabByLabId(instance.labId);
    if (!proLab) {
      throw new NotFoundError('Assertion configuration not found for this lab.');
    }

    const assertions: Array<{ name: string; passed: boolean; message: string | null }> = [];
    const groupEntries = Object.entries(proLab.flagValues ?? {});
    for (const [checkpointId, assertionGroupId] of groupEntries) {
      const definitions = resolveAssertionGroup(assertionGroupId);
      if (!definitions) {
        logger.error(
          { labId: instance.labId, assertionGroupId },
          'Unknown assertion group referenced by lab configuration',
        );
        assertions.push({
          name: checkpointId,
          passed: false,
          message: 'This checkpoint is not configured correctly on the platform.',
        });
        continue;
      }
      for (const definition of definitions) {
        try {
          const passed = await this.runDefinition(instanceId, definition);
          assertions.push({ name: checkpointId, passed, message: passed ? null : definition.hint });
        } catch (error) {
          logger.error({ err: error, instanceId }, 'Assertion execution failed — instance unreachable');
          throw new AppError(
            'The lab instance is unreachable right now. Check that it is running and try again.',
            HTTP_STATUS.SERVICE_UNAVAILABLE,
          );
        }
      }
    }

    const allPassed = assertions.length > 0 && assertions.every((assertion) => assertion.passed);
    if (!allPassed) {
      await activityLogService.recordEvent(userId, 'LAB_FAILED', {
        labId: instance.labId,
        labType: instance.labType,
        instanceId: instance.instanceId,
        passedChecks: assertions.filter((assertion) => assertion.passed).length,
        totalChecks: assertions.length,
        failedAt: new Date().toISOString(),
      });
      return { instanceId, assertions, allPassed, completedAt: null };
    }
    const completedAt = await this.markCompleted(userId, instance);

    return { instanceId, assertions, allPassed, completedAt };
  }

  private async runDefinition(
    instanceId: number,
    definition: { check: 'shell' | 'http'; command?: string; expectExitCode?: number; stdoutContains?: string; httpPath?: string; expectHttpStatus?: number },
  ): Promise<boolean> {
    if (definition.check === 'http') {
      const probe = await this.deps.orchestration.probeHttp(instanceId, definition.httpPath ?? '/');
      return probe.statusCode === definition.expectHttpStatus;
    }
    const result = await this.deps.orchestration.executeCommand(instanceId, definition.command ?? '');
    if (definition.expectExitCode !== undefined && result.exitCode !== definition.expectExitCode) {
      return false;
    }
    if (definition.stdoutContains !== undefined && definition.stdoutContains !== '') {
      return (result.stdout ?? '').includes(definition.stdoutContains);
    }
    return true;
  }

  /** LAB_COMPLETED activity event + early expiry so the monitor reaps the box. */
  private async markCompleted(userId: number, instance: InstanceRow): Promise<string> {
    const passedAt = new Date();
    const event: LabCompletionEvent = {
      labId: instance.labId!,
      labType: instance.labType,
      instanceId: instance.instanceId,
      passedAt: passedAt.toISOString(),
      timeTakenSeconds: await this.timeTakenSeconds(userId, instance.instanceId),
    };
    await this.deps.repo.updateInstanceExpiry(
      instance.instanceId,
      new Date(passedAt.getTime() + COMPLETED_GRACE_MINUTES * 60_000),
    );
    await activityLogService.recordEvent(userId, 'LAB_COMPLETED', { ...event });
    return passedAt.toISOString();
  }

  private async timeTakenSeconds(userId: number, instanceId: number): Promise<number | null> {
    const startedAt = await this.deps.repo.findLabStartTime(userId, instanceId);
    if (!startedAt) {
      return null;
    }
    return Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
  }
}

export const assertionService = new AssertionService();