import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../src/shared/errors';
import {
  AssertionService,
  type AssertionServiceDeps,
} from '../../src/features/labs/services/AssertionService';
import { SherlockService, type SherlockServiceDeps } from '../../src/features/labs/services/SherlockService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function proLabRow(flagValues: Record<string, string> | null = null) {
  return {
    proLabId: 1,
    labId: 1,
    networkIpRange: '10.0.0.0/24',
    totalMachines: 2,
    requiredRootCount: 1,
    flagValues,
    activeUsersCount: 3,
  };
}

function sherlockRow() {
  return {
    sherlockId: 2,
    labId: 2,
    evidenceFileUrl: 'https://cdn.example.com/evidence.pcap',
    evidenceFileSize: 2048,
    fileHash: 'abc123',
    questions: [
      { id: 'q1', text: 'Which port?', hint: 'Check the SYN packets' },
      { id: 'q2', text: 'What user?', hint: null },
    ],
    answers: [
      { id: 'q1', answer: '8080' },
      { id: 'q2', answer: 'root' },
    ],
    requiredCorrectAnswers: 2,
  };
}

function instanceRow() {
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
    startedAt: new Date('2026-02-01T10:00:00Z'),
    expiresAt: new Date('2026-02-01T12:00:00Z'),
    terminatedAt: null,
  };
}

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

function makeAssertionRepo(): Mocked<AssertionServiceDeps['repo']> {
  return {
    findProLabByLabId: vi.fn(async () => proLabRow()),
    findInstanceForUser: vi.fn(async () => instanceRow()),
    updateInstanceExpiry: vi.fn(async () => undefined),
    hasLabCompletionEvent: vi.fn(async () => false),
    findLabStartTime: vi.fn(async () => new Date('2026-02-01T10:00:00Z')),
  };
}

function makeAssertionService(overrides: Partial<Record<keyof AssertionServiceDeps, unknown>> = {}) {
  const repo = (overrides.repo ?? makeAssertionRepo()) as Mocked<AssertionServiceDeps['repo']>;
  const orchestration = (overrides.orchestration ?? {
    executeCommand: vi.fn(async () => ({ exitCode: 0, stdout: 'Up 5 seconds' })),
    probeHttp: vi.fn(async () => ({ statusCode: 200 })),
  }) as Mocked<AssertionServiceDeps['orchestration']>;
  const service = new AssertionService({ repo, orchestration });
  return { service, repo, orchestration };
}

describe('F6 AssertionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns PASS results and writes LAB_COMPLETED when all assertions pass', async () => {
    const repo = makeAssertionRepo();
    repo.findProLabByLabId.mockResolvedValue(
      proLabRow({ cp1: 'docker-containers', cp2: 'nginx-health' }) as never,
    );
    const { service } = makeAssertionService({ repo });
    const result = await service.runChecks(7, 42);

    expect(result.allPassed).toBe(true);
    expect(result.assertions).toEqual([
      { name: 'cp1', passed: true, message: null },
      { name: 'cp2', passed: true, message: null },
    ]);
    expect(result.completedAt).toEqual(expect.any(String));
    expect(repo.updateInstanceExpiry).toHaveBeenCalled();
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_COMPLETED',
      expect.objectContaining({ labId: 1, instanceId: 42 }),
    );
  });

  it('returns FAIL hints only (no command output) on partial pass; no completion', async () => {
    const repo = makeAssertionRepo();
    repo.findProLabByLabId.mockResolvedValue(
      proLabRow({ cp1: 'docker-containers' }) as never,
    );
    const orchestration = {
      executeCommand: vi.fn(async () => ({ exitCode: 1, stdout: 'docker: command not found' })),
      probeHttp: vi.fn(async () => ({ statusCode: 500 })),
    };
    const { service } = makeAssertionService({ repo, orchestration });
    const result = await service.runChecks(7, 42);

    expect(result.allPassed).toBe(false);
    expect(result.completedAt).toBeNull();
    expect(result.assertions[0]).toEqual(
      expect.objectContaining({ passed: false, message: expect.any(String) }),
    );
    expect(JSON.stringify(result)).not.toContain('docker: command not found');
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_FAILED',
      expect.objectContaining({ labId: 1, instanceId: 42, passedChecks: 0, totalChecks: 1 }),
    );
  });

  it('throws 503 when the instance is unreachable (adapter failure)', async () => {
    const repo = makeAssertionRepo();
    repo.findProLabByLabId.mockResolvedValue(proLabRow({ cp1: 'nginx-health' }) as never);
    const orchestration = {
      executeCommand: vi.fn(async () => ({ exitCode: 0, stdout: '' })),
      probeHttp: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };
    const { service } = makeAssertionService({ repo, orchestration });

    await expect(service.runChecks(7, 42)).rejects.toMatchObject({ statusCode: 503 });
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).not.toHaveBeenCalledWith(7, 'LAB_FAILED', expect.anything());
    expect(recordEvent).not.toHaveBeenCalledWith(7, 'LAB_COMPLETED', expect.anything());
  });

  it('throws 409 on an already-completed lab', async () => {
    const repo = makeAssertionRepo();
    repo.hasLabCompletionEvent.mockResolvedValue(true as never);
    const { service } = makeAssertionService({ repo });
    await expect(service.runChecks(7, 42)).rejects.toThrow(ConflictError);
  });

  it('throws 409 when the instance is not running', async () => {
    const repo = makeAssertionRepo();
    repo.findInstanceForUser.mockResolvedValue({ ...instanceRow(), status: 'stopped' } as never);
    const { service } = makeAssertionService({ repo });
    await expect(service.runChecks(7, 42)).rejects.toThrow(ConflictError);
  });

  it('throws 404 for another user’s instance', async () => {
    const repo = makeAssertionRepo();
    repo.findInstanceForUser.mockResolvedValue(null as never);
    const { service } = makeAssertionService({ repo });
    await expect(service.runChecks(7, 999)).rejects.toThrow(NotFoundError);
  });
});

describe('F6 SherlockService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSherlockRepo(): Mocked<SherlockServiceDeps['repo']> {
    return {
      findSherlockByLabId: vi.fn(async () => sherlockRow()),
      findProLabByLabId: vi.fn(async () => null),
      hasLabCompletionEvent: vi.fn(async () => false),
      findLabStartTime: vi.fn(async () => new Date('2026-02-01T10:00:00Z')),
      findAnyActiveInstanceForUser: vi.fn(async () => instanceRow()),
    };
  }

  it('passes when all answers are correct (case/whitespace-insensitive)', async () => {
    const service = new SherlockService({ repo: makeSherlockRepo() });
    const result = await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: ' 8080 ' },
      { questionId: 'q2', answer: 'ROOT' },
    ]);
    expect(result.isPassed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.results).toEqual([
      { questionId: 'q1', passed: true },
      { questionId: 'q2', passed: true },
    ]);
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_COMPLETED',
      expect.objectContaining({ labId: 2, labType: 'sherlock' }),
    );
  });

  it('fails on wrong answers and never leaks the answers JSON', async () => {
    const service = new SherlockService({ repo: makeSherlockRepo() });
    const result = await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: '9090' },
      { questionId: 'q2', answer: 'admin' },
    ]);
    expect(result.isPassed).toBe(false);
    expect(result.score).toBe(0);
    expect(JSON.stringify(result)).not.toContain('8080');
    expect(JSON.stringify(result)).not.toContain('correctAnswer');
  });

  it('throws 409 when the lab was already completed', async () => {
    const repo = makeSherlockRepo();
    repo.hasLabCompletionEvent.mockResolvedValue(true as never);
    const service = new SherlockService({ repo });
    await expect(
      service.submitAnswers(7, 2, [{ questionId: 'q1', answer: '8080' }]),
    ).rejects.toThrow(ConflictError);
  });
});