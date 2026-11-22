import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { LabService, type LabServiceDeps } from '../../../src/features/labs/services/LabService';
import { VpnService, type VpnServiceDeps } from '../../../src/features/labs/services/VpnService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function labRow(overrides: Record<string, unknown> = {}) {
  return {
    labId: 1,
    labName: 'Docker Deep Dive',
    slug: 'docker-deep-dive',
    description: 'Master Docker',
    difficultyId: 2,
    difficultyName: 'Intermediate',
    categoryId: 3,
    categoryName: 'Containers',
    labType: 'pro_lab' as const,
    isActive: true,
    isPremium: false,
    estimatedHours: 4,
    networkDiagramUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function instanceRow(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: 42,
    userId: 7,
    vpnId: 1,
    labId: 1,
    labType: 'pro_lab' as const,
    hostname: 'box-42.example.com',
    assignedIp: '10.0.0.42',
    sshPort: 22,
    rootPassword: 'secret',
    ramGb: 4,
    cpuCores: 4,
    diskGb: 30,
    status: 'running' as const,
    startedAt: new Date('2026-02-01T10:00:00Z'),
    expiresAt: new Date(Date.now() + 3_600_000),
    terminatedAt: null,
    ...overrides,
  };
}

vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
  cacheKeys: {
    labExtendCount: (instanceId: number): string => `lab_extend:${instanceId}`,
    aiMentorSession: (userId: number, lessonId: number): string => `ai_mentor:${userId}:${lessonId}`,
    aiMentorRate: (userId: number): string => `ai_mentor_rate:${userId}`,
  },
}));

function makeRepo(): Mocked<LabServiceDeps['repo']> {
  return {
    listLabs: vi.fn(async () => [labRow()]),
    findLabById: vi.fn(async () => labRow()),
    findLabBySlug: vi.fn(async () => null),
    findProLabByLabId: vi.fn(async () => null),
    findSherlockByLabId: vi.fn(async () => null),
    findActiveInstanceForUser: vi.fn(async () => null),
    findAnyActiveInstanceForUser: vi.fn(async () => null),
    findInstanceForUser: vi.fn(async () => instanceRow()),
    insertInstance: vi.fn(async () => 42),
    insertActivity: vi.fn(async () => undefined),
    updateInstanceStatus: vi.fn(async () => undefined),
    updateInstanceExpiry: vi.fn(async () => undefined),
    updateInstanceEndpoint: vi.fn(async () => undefined),
    hasLabCompletionEvent: vi.fn(async () => false),
    getPointsMultiplier: vi.fn(async () => 1),
  };
}

function makeVpn(): Mocked<VpnServiceDeps['repo']> {
  return {
    assignVpnServer: vi.fn(async () => ({
      assignmentId: 5,
      server: { vpnId: 1, serverName: 'us-east-1', serverLocation: 'Virginia', region: 'US' as const },
    })),
    findActiveAssignmentForUser: vi.fn(async () => null),
    findAssignmentForUser: vi.fn(async () => null),
    deactivateAssignment: vi.fn(async () => undefined),
    decrementVpnServerUsers: vi.fn(async () => undefined),
  };
}

function makeService(overrides: Partial<Record<keyof LabServiceDeps, unknown>> = {}) {
  const repo = (overrides.repo ?? makeRepo()) as Mocked<LabServiceDeps['repo']>;
  const orchestration = (overrides.orchestration ?? {
    getInstance: vi.fn(async () => null),
    createInstance: vi.fn(async () => ({
      hostname: 'box-42.example.com',
      assignedIp: '10.0.0.42',
      sshPort: 22,
      terminalWsUrl: 'wss://terminal.example.com/42',
    })),
    stopInstance: vi.fn(async () => undefined),
    terminateInstance: vi.fn(async () => undefined),
  }) as Mocked<LabServiceDeps['orchestration']>;
  const entitlement = (overrides.entitlement ?? {
    assertLabAccess: vi.fn(async () => undefined),
    getLabTtlHours: vi.fn(async () => 4),
    getExtensionLimit: vi.fn(async () => 3),
  }) as Mocked<LabServiceDeps['entitlement']>;
  const vpn = (overrides.vpn ?? {
    ensureAssignmentForProvision: vi.fn(async () => ({
      assignmentId: 5,
      vpnId: 1,
      ovpnConfigUrl: null,
    })),
    releaseAssignmentForUser: vi.fn(async () => undefined),
  }) as Mocked<LabServiceDeps['vpn']>;
  const tx = { tag: 'tx' };
  const award = (overrides.award ?? {
    withUserLock: vi.fn(async (_userId: number, fn: (handle: unknown) => Promise<unknown>) => fn(tx)),
  }) as Mocked<LabServiceDeps['award']>;
  const check = (overrides.check ?? {
    runSetup: vi.fn(async () => undefined),
  }) as Mocked<LabServiceDeps['check']>;
  const service = new LabService({
    repo,
    orchestration,
    entitlement,
    vpn,
    award,
    check,
    maxExtensions: 3,
    extendMinutes: 60,
  });
  return { service, repo, orchestration, entitlement, vpn, award, check, tx };
}

describe('LabService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLabDetail (D21 allowlist)', () => {
    const spec = {
      version: 2,
      mode: 'guided',
      scenario: { intro: 'Fix the box.', setup: ['echo secret-setup'] },
      completionBonus: 50,
      steps: [
        {
          id: 's1', title: 'Find it', instructions: 'Look around.', kind: 'task', setup: [],
          check: { type: 'command', command: 'echo secret-check', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 },
          hints: [{ id: 'h1', text: 'secret-hint' }], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0,
        },
        {
          id: 's2', title: 'Name it', instructions: 'Which one?', kind: 'question', setup: [],
          answer: { accepted: ['secret-answer'], normalize: 'trim_lower' },
          hints: [], points: 10, hintCost: 5, wrongPenalty: 2, guessPenalty: 5,
        },
      ],
    };

    it('returns only the step summary with scaled points and never the stored spec', async () => {
      const repo = makeRepo();
      repo.findProLabByLabId.mockResolvedValue({ proLabId: 1, labId: 1, flagValues: spec } as never);
      repo.getPointsMultiplier.mockResolvedValue(1.5);
      repo.hasLabCompletionEvent.mockResolvedValue(true);
      const { service } = makeService({ repo });

      const detail = await service.getLabDetail(1, 7);

      expect(detail).toMatchObject({
        mode: 'guided',
        scenarioIntro: 'Fix the box.',
        stepCount: 2,
        isCompleted: true,
        // round(25*1.5)=38, round(10*1.5)=15, round(50*1.5)=75
        pointsAvailable: 38 + 15 + 75,
        steps: [
          { stepId: 's1', position: 1, title: 'Find it', kind: 'task', points: 38 },
          { stepId: 's2', position: 2, title: 'Name it', kind: 'question', points: 15 },
        ],
      });
      expect(detail).not.toHaveProperty('proLab');
      expect(JSON.stringify(detail)).not.toMatch(/secret-/);
    });

    it('exposes no steps for an anonymous viewer of a lab without a v2 spec', async () => {
      const repo = makeRepo();
      repo.findProLabByLabId.mockResolvedValue({ proLabId: 1, labId: 1, flagValues: { cp1: 'group-1' } } as never);
      const { service } = makeService({ repo });

      const detail = await service.getLabDetail(1, null);

      expect(detail).toMatchObject({ mode: null, stepCount: 0, pointsAvailable: 0, steps: [], isStarted: false, isCompleted: false });
      expect(repo.hasLabCompletionEvent).not.toHaveBeenCalled();
      expect(JSON.stringify(detail)).not.toContain('group-1');
    });
  });

  describe('provisionInstance', () => {
    const readySpec = {
      version: 2,
      mode: 'guided',
      scenario: { intro: '', setup: ['echo scenario-setup'] },
      completionBonus: 50,
      steps: [
        {
          id: 's1', title: 'Find it', instructions: 'Look around.', kind: 'task', setup: [],
          check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 },
          hints: [], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0,
        },
      ],
    };
    function readyRepo() {
      const repo = makeRepo();
      repo.findProLabByLabId.mockResolvedValue({ proLabId: 1, labId: 1, flagValues: readySpec } as never);
      return repo;
    }

    it('runs the user lock around the instance insert and takes the VPN assignment before it', async () => {
      const { service, repo, vpn, award, tx } = makeService({ repo: readyRepo() });
      await service.provisionInstance(7, 1, 'US');

      expect(award.withUserLock).toHaveBeenCalledTimes(1);
      expect(award.withUserLock).toHaveBeenCalledWith(7, expect.any(Function));
      expect(repo.insertInstance.mock.calls[0][1]).toBe(tx);
      const vpnOrder = vpn.ensureAssignmentForProvision.mock.invocationCallOrder[0];
      const lockOrder = award.withUserLock.mock.invocationCallOrder[0];
      expect(vpnOrder).toBeLessThan(lockOrder);
    });

    it('does not insert or write LAB_STARTED when the active-instance check under the lock finds a live instance', async () => {
      const repo = readyRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow({ status: 'stopped' }) as never);
      const { service, orchestration } = makeService({ repo });

      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({
        errors: [{ code: 'INSTANCE_ALREADY_ACTIVE', instanceId: 42, labId: 1 }],
      });
      expect(repo.insertActivity).not.toHaveBeenCalled();
      expect(orchestration.createInstance).not.toHaveBeenCalled();
    });

    it('refuses a lab without a v2 spec with 409 LAB_NOT_READY (learners)', async () => {
      const { service, repo } = makeService();
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({
        statusCode: 409,
        errors: [{ code: 'LAB_NOT_READY' }],
      });
      expect(repo.insertInstance).not.toHaveBeenCalled();
    });

    it('provisions a running instance by lab slug, never generates a root password, writes LAB_STARTED', async () => {
      const { service, repo, orchestration, vpn, check, tx } = makeService({ repo: readyRepo() });
      const result = await service.provisionInstance(7, 1, 'US');

      expect(repo.findAnyActiveInstanceForUser).toHaveBeenCalledWith(7, tx);
      expect(repo.insertInstance).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, vpnId: 1, status: 'pending' }),
        tx,
      );
      expect(repo.insertInstance.mock.calls[0][0]).not.toHaveProperty('rootPassword');
      expect(repo.insertActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          activityType: 'LAB_STARTED',
          details: expect.objectContaining({ labId: 1, labSlug: 'docker-deep-dive', instanceId: 42 }),
        }),
        tx,
      );
      expect(check.runSetup).toHaveBeenCalledWith(42, ['echo scenario-setup']);
      expect(orchestration.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({ labId: 1, labSlug: 'docker-deep-dive', instanceId: 42 }),
      );
      expect(orchestration.createInstance.mock.calls[0][0]).not.toHaveProperty('rootPassword');
      expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'running');
      expect(vpn.ensureAssignmentForProvision).toHaveBeenCalledWith(7, 'US');
      expect(result).toEqual(
        expect.objectContaining({
          instanceId: 42,
          labId: 1,
          labSlug: 'docker-deep-dive',
          status: 'running',
          vpnAssignment: { ovpnConfigUrl: null },
        }),
      );
      expect(result).not.toHaveProperty('rootPassword');
    });

    it('lets admins provision an inactive lab without a v2 spec (allowInactive)', async () => {
      const repo = makeRepo();
      repo.findLabById.mockResolvedValue(labRow({ isActive: false }) as never);
      const { service, check } = makeService({ repo });
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({ errors: [{ code: 'LAB_NOT_FOUND' }] });
      const result = await service.provisionInstance(7, 1, null, { allowInactive: true });
      expect(result.status).toBe('running');
      expect(check.runSetup).not.toHaveBeenCalled();
    });

    it('throws 409 INSTANCE_ALREADY_ACTIVE when a second instance of the same lab is attempted', async () => {
      const repo = readyRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow() as never);
      const { service } = makeService({ repo });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow(ConflictError);
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({
        errors: [{ code: 'INSTANCE_ALREADY_ACTIVE', instanceId: 42, labId: 1 }],
      });
      expect(repo.insertInstance).not.toHaveBeenCalled();
    });

    it('throws 409 INSTANCE_ALREADY_ACTIVE when an instance of another lab is running', async () => {
      const repo = readyRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow({ labId: 9 }) as never);
      const { service } = makeService({ repo });
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({
        statusCode: 409,
        errors: [{ code: 'INSTANCE_ALREADY_ACTIVE', instanceId: 42, labId: 9 }],
      });
    });

    it('throws 403 when the entitlement gate denies premium access', async () => {
      const entitlement = {
        assertLabAccess: vi.fn(async () => {
          throw new ForbiddenError('premium required');
        }),
        getLabTtlHours: vi.fn(async () => 4),
        getExtensionLimit: vi.fn(async () => 3),
      };
      const { service, repo } = makeService({ entitlement, repo: readyRepo() });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow(ForbiddenError);
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({
        errors: [{ code: 'LAB_ACCESS_DENIED' }],
      });
      expect(repo.insertInstance).not.toHaveBeenCalled();
    });

    it('marks the instance errored and releases the VPN when provisioning fails', async () => {
      const orchestration = {
        getInstance: vi.fn(async () => null),
        createInstance: vi.fn(async () => {
          throw new Error('orchestration down');
        }),
        stopInstance: vi.fn(async () => undefined),
        terminateInstance: vi.fn(async () => undefined),
      };
      const { service, repo, vpn } = makeService({ orchestration, repo: readyRepo() });
      await expect(service.provisionInstance(7, 1, null)).rejects.toMatchObject({ statusCode: 500 });
      expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'error');
      expect(vpn.releaseAssignmentForUser).toHaveBeenCalledWith(7);
    });
  });

  describe('getActiveInstance', () => {
    it('returns the terminal endpoint from the orchestrator', async () => {
      const repo = makeRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow() as never);
      const orchestration = {
        getInstance: vi.fn(async () => ({ terminalWsUrl: 'wss://terminal.example.com/42' })),
        createInstance: vi.fn(),
        stopInstance: vi.fn(),
        terminateInstance: vi.fn(),
      };
      const { service } = makeService({ repo, orchestration: orchestration as never });

      const active = await service.getActiveInstance(7);

      expect(orchestration.getInstance).toHaveBeenCalledWith(42);
      expect(active).toMatchObject({ instanceId: 42, labId: 1, labName: 'Docker Deep Dive', terminalWsUrl: 'wss://terminal.example.com/42' });
    });

    it('returns terminalWsUrl null, not a localhost fallback, when the orchestrator is unreachable', async () => {
      const repo = makeRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow() as never);
      const orchestration = {
        getInstance: vi.fn(async () => {
          throw new Error('orchestrator down');
        }),
        createInstance: vi.fn(),
        stopInstance: vi.fn(),
        terminateInstance: vi.fn(),
      };
      const { service } = makeService({ repo, orchestration: orchestration as never });

      const active = await service.getActiveInstance(7);

      expect(active).not.toBeNull();
      expect(active?.instanceId).toBe(42);
      expect(active?.terminalWsUrl).toBeNull();
      expect(JSON.stringify(active)).not.toContain('localhost');
    });

    it('returns null when the learner has no live instance', async () => {
      const { service, orchestration } = makeService();
      await expect(service.getActiveInstance(7)).resolves.toBeNull();
      expect(orchestration.getInstance).not.toHaveBeenCalled();
    });
  });

  describe('terminateInstance', () => {
    it('enforces ownership, terminates, decrements VPN users and writes LAB_TERMINATED', async () => {
      const repo = makeRepo();
      repo.findInstanceForUser.mockResolvedValue(instanceRow() as never);
      const vpn = {
        ensureAssignmentForProvision: vi.fn(),
        releaseAssignmentForUser: vi.fn(async () => undefined),
      };
      const { service, orchestration } = makeService({ repo, vpn });
      const result = await service.terminateInstance(7, 42);

      expect(repo.findInstanceForUser).toHaveBeenCalledWith(7, 42);
      expect(orchestration.terminateInstance).toHaveBeenCalledWith(42);
      expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'terminated');
      expect(vpn.releaseAssignmentForUser).toHaveBeenCalledWith(7);
      expect(result).toEqual({ instanceId: 42, status: 'terminated' });
    });

    it('throws 404 for another user’s instance (IDOR)', async () => {
      const repo = makeRepo();
      repo.findInstanceForUser.mockResolvedValue(null as never);
      const { service } = makeService({ repo });
      await expect(service.terminateInstance(7, 999)).rejects.toThrow(NotFoundError);
    });
  });

  describe('extendInstance', () => {
    it('extends expires_at by the configured minutes and tracks usage in Redis', async () => {
      const { service, repo } = makeService();
      const result = await service.extendInstance(7, 42);
      expect(repo.updateInstanceExpiry).toHaveBeenCalledWith(
        42,
        expect.any(Date),
      );
      expect(result.extensionsUsed).toBe(1);
      expect(result.extensionsRemaining).toBe(2);
    });

    it('throws 403 once the extension limit is reached', async () => {
      const redis = (await import('../../../src/app/cache/redis')).redisClient as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      redis.get.mockResolvedValue('3' as never);
      const { service } = makeService();
      await expect(service.extendInstance(7, 42)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe('VpnService', () => {
  it('returns a signed config URL for a fresh assignment', async () => {
    const service = new VpnService({ repo: makeVpn() });
    const config = await service.getOrCreateAssignment(7, 'US');
    expect(config.assignmentId).toBe(5);
    expect(config.ovpnConfigUrl).toContain('/labs/vpn/ovpn/5?');
    expect(config.ovpnConfigUrl).toContain('sig=');
  });

  it('reuses an existing active assignment instead of creating a new one', async () => {
    const repo = makeVpn();
    repo.findActiveAssignmentForUser.mockResolvedValue({
      assignmentId: 9,
      vpnId: 2,
      assignedIp: '10.0.0.9',
      ovpnConfigUrl: null,
      assignedAt: new Date('2026-02-01T10:00:00Z'),
      expiresAt: null,
      serverName: 'eu-central-1',
      serverLocation: 'Frankfurt',
      region: 'EU' as const,
    } as never);
    const service = new VpnService({ repo });
    const config = await service.getOrCreateAssignment(7, 'EU');
    expect(repo.assignVpnServer).not.toHaveBeenCalled();
    expect(config.assignmentId).toBe(9);
  });

  it('maps pool exhaustion to a user-safe 404', async () => {
    const repo = makeVpn();
    repo.assignVpnServer.mockRejectedValue(new Error('NO_VPN_CAPACITY') as never);
    const service = new VpnService({ repo });
    await expect(service.getOrCreateAssignment(7, 'US')).rejects.toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });
});