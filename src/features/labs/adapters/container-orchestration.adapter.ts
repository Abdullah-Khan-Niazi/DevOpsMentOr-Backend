import { env } from '../../../app/config';
import { AppError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';

export interface ContainerInstanceInput {
  labId: number;
  instanceId: number;
  rootPassword: string;
  ramGb: number;
  cpuCores: number;
  diskGb: number;
}

export interface ContainerInstanceEndpoint {
  hostname: string;
  assignedIp: string;
  sshPort: number;
  terminalWsUrl: string;
}

export interface ContainerCommandResult {
  exitCode: number;
  stdout: string;
}

export interface ContainerHttpProbeResult {
  statusCode: number;
  ok: boolean;
}

/**
 * F6 §08 abstract adapter for the external container orchestration API
 * (Docker / Kubernetes pod provisioning and teardown).
 *
 * BLOCKING condition (F6 §12): the target API URL MUST come from
 * `CONTAINER_ORCHESTRATION_API_URL` in `.env`. When it is empty the adapter
 * fails with a user-safe 500 (invariant 13) and a Pino error log; no
 * credentials or command output are ever logged.
 */
export class ContainerOrchestrationAdapter {
  async createInstance(input: ContainerInstanceInput): Promise<ContainerInstanceEndpoint> {
    const endpoint = this.endpointOrThrow();
    const response = await fetch(`${endpoint}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const status = response.status;
      logger.error({ status, instanceId: input.instanceId, labId: input.labId }, 'Container orchestration create failed');
      throw new AppError(
        'The lab environment could not be provisioned. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
    const body = (await response.json()) as {
      hostname: string;
      assignedIp: string;
      sshPort: number;
      terminalWsUrl: string;
    };
    return body;
  }

  async stopInstance(instanceId: number): Promise<void> {
    const endpoint = this.endpointOrThrow();
    const response = await fetch(`${endpoint}/instances/${instanceId}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.error({ status: response.status, instanceId }, 'Container orchestration stop failed');
      throw new AppError(
        'The lab environment could not be stopped. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async terminateInstance(instanceId: number): Promise<void> {
    const endpoint = this.endpointOrThrow();
    const response = await fetch(`${endpoint}/instances/${instanceId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) {
      logger.error({ status: response.status, instanceId }, 'Container orchestration terminate failed');
      throw new AppError(
        'The lab environment could not be terminated. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Server-side shell command execution (assertion engine); output stays internal. */
  async executeCommand(instanceId: number, command: string): Promise<ContainerCommandResult> {
    const endpoint = this.endpointOrThrow();
    const response = await fetch(`${endpoint}/instances/${instanceId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new AppError(
        'The lab environment is unreachable. Please try again.',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
    }
    const body = (await response.json()) as { exitCode: number; stdout: string };
    return body;
  }

  /** Server-side HTTP probe against the lab environment. */
  async probeHttp(instanceId: number, path: string): Promise<ContainerHttpProbeResult> {
    const endpoint = this.endpointOrThrow();
    const response = await fetch(`${endpoint}/instances/${instanceId}/http`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new AppError(
        'The lab environment is unreachable. Please try again.',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
      );
    }
    const body = (await response.json()) as { statusCode: number; ok: boolean };
    return body;
  }

  private endpointOrThrow(): string {
    if (!env.CONTAINER_ORCHESTRATION_API_URL) {
      logger.error('Container orchestration API URL is not configured.');
      throw new AppError(
        'The lab environment is not available right now. Please try again later.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
    return env.CONTAINER_ORCHESTRATION_API_URL.replace(/\/$/, '');
  }
}

export const containerOrchestrationAdapter = new ContainerOrchestrationAdapter();