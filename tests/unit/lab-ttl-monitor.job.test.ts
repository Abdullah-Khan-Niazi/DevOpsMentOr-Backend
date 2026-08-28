import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabTtlMonitorJob, type LabTtlMonitorJobDeps } from '../../src/features/labs/jobs/LabTtlMonitorJob';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

function expiredInstance(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: 42,
    userId: 7,
    vpnId: 1,
    labId: 1,
    labType: 'pro_lab' as const,
    hostname: null,
    assignedIp: null,
    sshPort: 22,
    rootPassword: 'secret',
    ramGb: 4,
    cpuCores: 4,
    diskGb: 30,
    status: 'running' as const,
    startedAt: new Date('2026-02-01T08:00:00Z'),
    expiresAt: new Date('2026-02-01T10:00:00Z'),
    terminatedAt: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<Record<keyof LabTtlMonitorJobDeps, unknown>> = {}) {
  const repo = (overrides.repo ?? {
    listExpiredInstances: vi.fn(async () => [expiredInstance()]),
    updateInstanceStatus: vi.fn(async () => undefined),
  }) as Mocked<LabTtlMonitorJobDeps['repo']>;
  const orchestration = (overrides.orchestration ?? {
    terminateInstance: vi.fn(async () => undefined),
  }) as Mocked<LabTtlMonitorJobDeps['orchestration']>;
  const vpn = (overrides.vpn ?? {
    releaseAssignmentForUser: vi.fn(async () => undefined),
  }) as Mocked<LabTtlMonitorJobDeps['vpn']>;
  const job = new LabTtlMonitorJob({ repo, orchestration, vpn, intervalSeconds: 60 });
  return { job, repo, orchestration, vpn };
}

describe('F6 LabTtlMonitorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('terminates expired instances, marks them terminated and releases VPN slots', async () => {
    const { job, repo, orchestration, vpn } = makeJob();
    const terminated = await job.run();

    expect(terminated).toBe(1);
    expect(orchestration.terminateInstance).toHaveBeenCalledWith(42);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'terminated');
    expect(vpn.releaseAssignmentForUser).toHaveBeenCalledWith(7);
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_TERMINATED',
      expect.objectContaining({ instanceId: 42, reason: 'ttl_expired' }),
    );
  });

  it('skips instances whose orchestration termination fails, without crashing', async () => {
    const orchestration = {
      terminateInstance: vi.fn(async () => {
        throw new Error('orchestration unreachable');
      }),
    };
    const { job, repo, vpn } = makeJob({ orchestration });
    const terminated = await job.run();
    expect(terminated).toBe(0);
    expect(repo.updateInstanceStatus).not.toHaveBeenCalled();
    expect(vpn.releaseAssignmentForUser).not.toHaveBeenCalled();
  });
});