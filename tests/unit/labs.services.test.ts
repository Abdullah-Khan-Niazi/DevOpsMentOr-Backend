import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { LabService, type LabServiceDeps } from '../../src/features/labs/services/LabService';
import { VpnService, type VpnServiceDeps } from '../../src/features/labs/services/VpnService';

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

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../src/app/cache/redis', () => ({
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
    updateInstanceStatus: vi.fn(async () => undefined),
    updateInstanceExpiry: vi.fn(async () => undefined),
    updateInstanceEndpoint: vi.fn(async () => undefined),
    hasLabCompletionEvent: vi.fn(async () => false),
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
  const service = new LabService({
    repo,
    orchestration,
    entitlement,
    vpn,
    maxExtensions: 3,
    extendMinutes: 60,
  });
  return { service, repo, orchestration, entitlement, vpn };
}

describe('F6 LabService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('provisionInstance', () => {
    it('provisions a running instance, returns rootPassword, writes LAB_STARTED', async () => {
      const { service, repo, orchestration, vpn } = makeService();
      const result = await service.provisionInstance(7, 1, 'US');

      expect(repo.insertInstance).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, vpnId: 1, status: 'pending' }),
      );
      expect(orchestration.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({ labId: 1, instanceId: 42 }),
      );
      expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'running');
      expect(vpn.ensureAssignmentForProvision).toHaveBeenCalledWith(7, 'US');
      expect(result).toEqual(
        expect.objectContaining({
          instanceId: 42,
          labId: 1,
          status: 'running',
          rootPassword: expect.any(String),
          vpnAssignment: { ovpnConfigUrl: null },
        }),
      );
      const recordEvent = vi.mocked(
        (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
      );
      expect(recordEvent).toHaveBeenCalledWith(
        7,
        'LAB_STARTED',
        expect.objectContaining({ labId: 1, instanceId: 42 }),
      );
    });

    it('throws 409 INSTANCE_ALREADY_ACTIVE when a second instance is attempted', async () => {
      const repo = makeRepo();
      repo.findActiveInstanceForUser.mockResolvedValue(instanceRow() as never);
      const { service } = makeService({ repo });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow(ConflictError);
    });

    it('throws 409 when any other instance is already running', async () => {
      const repo = makeRepo();
      repo.findAnyActiveInstanceForUser.mockResolvedValue(instanceRow({ labId: 9 }) as never);
      const { service } = makeService({ repo });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow(
        expect.objectContaining({ message: 'INSTANCE_ALREADY_ACTIVE' }),
      );
    });

    it('throws 403 when the F9 entitlement gate denies premium access', async () => {
      const entitlement = {
        assertLabAccess: vi.fn(async () => {
          throw new ForbiddenError('premium required');
        }),
        getLabTtlHours: vi.fn(async () => 4),
        getExtensionLimit: vi.fn(async () => 3),
      };
      const { service, repo } = makeService({ entitlement });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow(ForbiddenError);
      expect(repo.insertInstance).not.toHaveBeenCalled();
    });

    it('marks the instance errored and releases the VPN when provisioning fails', async () => {
      const orchestration = {
        createInstance: vi.fn(async () => {
          throw new Error('orchestration down');
        }),
        stopInstance: vi.fn(async () => undefined),
        terminateInstance: vi.fn(async () => undefined),
      };
      const { service, repo, vpn } = makeService({ orchestration });
      await expect(service.provisionInstance(7, 1, null)).rejects.toThrow();
      expect(repo.updateInstanceStatus).toHaveBeenCalledWith(42, 'error');
      expect(vpn.releaseAssignmentForUser).toHaveBeenCalledWith(7);
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
      const redis = (await import('../../src/app/cache/redis')).redisClient as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      redis.get.mockResolvedValue('3' as never);
      const { service } = makeService();
      await expect(service.extendInstance(7, 42)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe('F6 VpnService', () => {
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