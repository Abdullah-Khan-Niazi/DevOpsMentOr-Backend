import { env } from '../../../app/config';
import { logger } from '../../../shared/logger';
import { activityLogService } from '../../progress/services/ActivityLogService';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { VpnService } from '../services/VpnService';
import { vpnService } from '../services/VpnService';

export interface LabTtlMonitorJobDeps {
  repo: Pick<LabsRepository, 'listExpiredInstances' | 'updateInstanceStatus'>;
  orchestration: Pick<ContainerOrchestrationAdapter, 'terminateInstance'>;
  vpn: Pick<VpnService, 'releaseAssignmentForUser'>;
  intervalSeconds: number;
}

function defaultDeps(): LabTtlMonitorJobDeps {
  return {
    repo: labsRepository,
    orchestration: containerOrchestrationAdapter,
    vpn: vpnService,
    intervalSeconds: env.LAB_TTL_MONITOR_INTERVAL_SECONDS,
  };
}

/**
 * F6 §05 §08 TTL enforcement (AC-04/AC-11): every `intervalSeconds` the job
 * finds instances past their `expires_at`, terminates them at the
 * orchestration layer, marks them `terminated`, releases the learner's VPN
 * assignment (decrementing `vpn_servers.current_users`) and writes the
 * LAB_TERMINATED activity event. Failures are logged; the monitor never
 * crashes the process.
 */
export class LabTtlMonitorJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: LabTtlMonitorJobDeps = defaultDeps()) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.run().catch((error) => {
        logger.error({ err: error }, 'Lab TTL monitor run failed');
      });
    }, this.deps.intervalSeconds * 1000);
    this.timer.unref();
    logger.info(`Lab TTL monitor started (interval: ${this.deps.intervalSeconds}s)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep; exposed for tests. */
  async run(): Promise<number> {
    const expired = await this.deps.repo.listExpiredInstances();
    let terminated = 0;
    for (const instance of expired) {
      try {
        await this.deps.orchestration.terminateInstance(instance.instanceId);
      } catch (error) {
        logger.error({ err: error, instanceId: instance.instanceId }, 'TTL terminate failed');
        continue;
      }
      await this.deps.repo.updateInstanceStatus(instance.instanceId, 'terminated');
      await this.deps.vpn.releaseAssignmentForUser(instance.userId);
      await activityLogService.recordEvent(instance.userId, 'LAB_TERMINATED', {
        labId: instance.labId,
        labType: instance.labType,
        instanceId: instance.instanceId,
        reason: 'ttl_expired',
      });
      terminated += 1;
    }
    if (terminated > 0) {
      logger.info({ terminated }, 'Lab TTL monitor terminated expired instances');
    }
    return terminated;
  }
}

export const labTtlMonitorJob = new LabTtlMonitorJob();