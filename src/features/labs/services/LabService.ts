import { randomBytes } from 'node:crypto';
import { env } from '../../../app/config';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { redisClient, cacheKeys } from '../../../app/cache/redis';
import { activityLogService } from '../../progress/services/ActivityLogService';
import type {
  ActiveInstanceDto,
  ExtendInstanceDto,
  LabDetailDto,
  LabDto,
  ProvisionInstanceDto,
  StopInstanceDto,
  TerminateInstanceDto,
  VpnRegion,
} from '../dto/labs.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { EntitlementService } from './EntitlementService';
import { entitlementService } from './EntitlementService';
import type { VpnService } from './VpnService';
import { vpnService } from './VpnService';
import type { InstanceRow, LabsRepository, LabRow, ProLabRow, SherlockRow } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export interface LabServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'findLabById'
    | 'findLabBySlug'
    | 'listLabs'
    | 'findProLabByLabId'
    | 'findSherlockByLabId'
    | 'findActiveInstanceForUser'
    | 'findAnyActiveInstanceForUser'
    | 'findInstanceForUser'
    | 'insertInstance'
    | 'updateInstanceStatus'
    | 'updateInstanceExpiry'
    | 'updateInstanceEndpoint'
    | 'hasLabCompletionEvent'
  >;
  orchestration: Pick<
    ContainerOrchestrationAdapter,
    'createInstance' | 'stopInstance' | 'terminateInstance'
  >;
  entitlement: Pick<EntitlementService, 'assertLabAccess' | 'getLabTtlHours' | 'getExtensionLimit'>;
  vpn: Pick<VpnService, 'ensureAssignmentForProvision' | 'releaseAssignmentForUser'>;
  maxExtensions: number;
  extendMinutes: number;
}

function defaultDeps(): LabServiceDeps {
  return {
    repo: labsRepository,
    orchestration: containerOrchestrationAdapter,
    entitlement: entitlementService,
    vpn: vpnService,
    maxExtensions: env.LAB_MAX_EXTENSIONS,
    extendMinutes: env.LAB_EXTEND_MINUTES,
  };
}

function generateRootPassword(): string {
  return randomBytes(12).toString('base64url').slice(0, 16);
}

/**
 * F6 §08 lab instance lifecycle: provision, stop, terminate, extend, active
 * status and the lab catalog. Every learner-scoped operation resolves the
 * instance through `user_id = session.userId` (IDOR mitigation); the F9
 * entitlement gate runs before provisioning; `root_password` is returned
 * only in the 201 provision payload (invariant 2).
 */
export class LabService {
  constructor(private readonly deps: LabServiceDeps = defaultDeps()) {}

  /* ── Catalog (LAB-01 / LAB-02) ───────────────────────────────────────── */

  async listLabs(): Promise<LabDto[]> {
    const rows = await this.deps.repo.listLabs(false);
    return rows.map((row) => this.toLabDto(row));
  }

  async getLabDetail(labId: number, userId: number | null): Promise<LabDetailDto> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || !lab.isActive) {
      throw new NotFoundError('Lab not found.');
    }
    const [proLab, sherlock] = await Promise.all([
      this.deps.repo.findProLabByLabId(labId),
      this.deps.repo.findSherlockByLabId(labId),
    ]);
    return {
      ...this.toLabDto(lab),
      isStarted: userId !== null && (await this.deps.repo.findActiveInstanceForUser(userId, labId)) !== null,
      proLab: proLab ? this.toProLabDto(proLab) : null,
      sherlock: sherlock ? this.toSherlockDto(sherlock) : null,
    };
  }

  /* ── Provision (LAB-03) ───────────────────────────────────────────────── */

  async provisionInstance(
    userId: number,
    labId: number,
    region: VpnRegion | null,
  ): Promise<ProvisionInstanceDto> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || !lab.isActive) {
      throw new NotFoundError('Lab not found.');
    }

    await this.deps.entitlement.assertLabAccess(userId, labId);

    const existing = await this.deps.repo.findActiveInstanceForUser(userId, labId);
    if (existing) {
      throw new ConflictError('You already have an active instance for this lab. Terminate it first.');
    }
    const anyActive = await this.deps.repo.findAnyActiveInstanceForUser(userId);
    if (anyActive) {
      throw new ConflictError('INSTANCE_ALREADY_ACTIVE');
    }

    const ttlHours = await this.deps.entitlement.getLabTtlHours(userId);
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    let assignment: { assignmentId: number; vpnId: number; ovpnConfigUrl: string | null };
    try {
      assignment = await this.deps.vpn.ensureAssignmentForProvision(userId, region);
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_VPN_CAPACITY') {
        throw new AppError(
          'No VPN server is available in your region right now. Please try again later.',
          HTTP_STATUS.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }

    const rootPassword = generateRootPassword();
    const instanceId = await this.deps.repo.insertInstance({
      userId,
      vpnId: assignment.vpnId,
      hostname: null,
      assignedIp: null,
      sshPort: 22,
      rootPassword,
      ramGb: lab.labType === 'pro_lab' ? 4 : 2,
      cpuCores: lab.labType === 'pro_lab' ? 4 : 2,
      diskGb: lab.labType === 'pro_lab' ? 30 : 20,
      status: 'pending',
      expiresAt,
    });

    let hostname: string | null = null;
    let assignedIp: string | null = null;
    let sshPort = 22;
    let terminalWsUrl = '';
    try {
      const endpoint = await this.deps.orchestration.createInstance({
        labId,
        instanceId,
        rootPassword,
        ramGb: lab.labType === 'pro_lab' ? 4 : 2,
        cpuCores: lab.labType === 'pro_lab' ? 4 : 2,
        diskGb: lab.labType === 'pro_lab' ? 30 : 20,
      });
      hostname = endpoint.hostname;
      assignedIp = endpoint.assignedIp;
      sshPort = endpoint.sshPort;
      terminalWsUrl = endpoint.terminalWsUrl;
      await this.deps.repo.updateInstanceEndpoint(instanceId, {
        hostname,
        assignedIp,
        sshPort,
      });
      await this.deps.repo.updateInstanceStatus(instanceId, 'running');
    } catch (error) {
      await this.deps.repo.updateInstanceStatus(instanceId, 'error');
      await this.deps.vpn.releaseAssignmentForUser(userId);
      logger.error({ err: error, userId, labId, instanceId }, 'Lab provisioning failed');
      throw new AppError(
        'The lab environment could not be provisioned. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }

    await activityLogService.recordEvent(userId, 'LAB_STARTED', {
      labId,
      labType: lab.labType,
      instanceId,
      region: region ?? null,
    });

    return {
      instanceId,
      labId,
      status: 'running',
      hostname,
      assignedIp,
      sshPort,
      rootPassword,
      terminalWsUrl,
      expiresAt: expiresAt.toISOString(),
      vpnAssignment: { ovpnConfigUrl: assignment.ovpnConfigUrl },
    };
  }

  /* ── Active instance (LAB-04) ─────────────────────────────────────────── */

  async getActiveInstance(userId: number): Promise<ActiveInstanceDto | null> {
    const row = await this.deps.repo.findAnyActiveInstanceForUser(userId);
    if (!row || !row.labId) {
      return null;
    }
    const lab = await this.deps.repo.findLabById(row.labId);
    return {
      instanceId: row.instanceId,
      labId: row.labId,
      labName: lab?.labName ?? 'Lab',
      slug: lab?.slug ?? '',
      status: row.status,
      hostname: row.hostname,
      assignedIp: row.assignedIp,
      sshPort: row.sshPort,
      ramGb: row.ramGb,
      cpuCores: row.cpuCores,
      diskGb: row.diskGb,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      terminalWsUrl: `${env.PUBLIC_API_URL}/terminal/ws/${row.instanceId}`,
    };
  }

  /* ── Stop (LAB-05) ────────────────────────────────────────────────────── */

  async stopInstance(userId: number, instanceId: number): Promise<StopInstanceDto> {
    await this.ownedLiveInstance(userId, instanceId);
    try {
      await this.deps.orchestration.stopInstance(instanceId);
    } catch (error) {
      logger.error({ err: error, userId, instanceId }, 'Lab stop failed');
      throw new AppError(
        'The lab environment could not be stopped. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
    await this.deps.repo.updateInstanceStatus(instanceId, 'stopped');
    return { instanceId, status: 'stopped' };
  }

  /* ── Terminate (LAB-06 / LAB-22) ──────────────────────────────────────── */

  async terminateInstance(
    userId: number,
    instanceId: number,
    reason = 'terminated by learner',
  ): Promise<TerminateInstanceDto> {
    const instance = await this.ownedLiveInstance(userId, instanceId);
    await this.terminate(instance, reason);
    return { instanceId, status: 'terminated' };
  }

  /** Shared teardown: orchestration, status, VPN release, activity event. */
  private async terminate(instance: InstanceRow, reason: string): Promise<void> {
    try {
      await this.deps.orchestration.terminateInstance(instance.instanceId);
    } catch (error) {
      logger.error({ err: error, instanceId: instance.instanceId }, 'Lab terminate failed');
      throw new AppError(
        'The lab environment could not be terminated. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }
    await this.deps.repo.updateInstanceStatus(instance.instanceId, 'terminated');
    await this.deps.vpn.releaseAssignmentForUser(instance.userId);
    await activityLogService.recordEvent(instance.userId, 'LAB_TERMINATED', {
      labId: instance.labId,
      labType: instance.labType,
      instanceId: instance.instanceId,
      reason,
    });
  }

  /* ── Extend (LAB-07) ──────────────────────────────────────────────────── */

  async extendInstance(userId: number, instanceId: number): Promise<ExtendInstanceDto> {
    const instance = await this.ownedLiveInstance(userId, instanceId);
    if (instance.expiresAt && instance.expiresAt.getTime() < Date.now()) {
      throw new ConflictError('This lab instance has already expired.');
    }

    const planLimit = await this.deps.entitlement.getExtensionLimit(userId);
    const limit = Math.min(this.deps.maxExtensions, planLimit);
    const countKey = cacheKeys.labExtendCount(instanceId);
    const used = Number((await redisClient.get(countKey)) ?? '0');
    if (used >= limit) {
      throw new ForbiddenError(
        `Your plan allows ${limit} extension${limit === 1 ? '' : 's'} per lab session.`,
      );
    }

    const base = instance.expiresAt ?? new Date();
    const newExpiresAt = new Date(base.getTime() + this.deps.extendMinutes * 60_000);
    await this.deps.repo.updateInstanceExpiry(instanceId, newExpiresAt);
    await redisClient.incr(countKey);
    await redisClient.expire(countKey, this.deps.extendMinutes * 60);

    return {
      instanceId,
      newExpiresAt: newExpiresAt.toISOString(),
      extensionsUsed: used + 1,
      extensionsRemaining: limit - used - 1,
    };
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  private async ownedLiveInstance(userId: number, instanceId: number): Promise<InstanceRow> {
    const instance = await this.deps.repo.findInstanceForUser(userId, instanceId);
    if (!instance) {
      throw new NotFoundError('Lab instance not found.');
    }
    if (instance.status === 'terminated' || instance.status === 'error') {
      throw new ConflictError('This lab instance is no longer active.');
    }
    return instance;
  }

  private toLabDto(row: LabRow): LabDto {
    return {
      labId: row.labId,
      labName: row.labName,
      slug: row.slug,
      description: row.description,
      difficultyId: row.difficultyId,
      difficultyName: row.difficultyName,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      labType: row.labType,
      isActive: row.isActive,
      isPremium: row.isPremium,
      estimatedHours: row.estimatedHours,
      networkDiagramUrl: row.networkDiagramUrl,
      isStarted: false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toProLabDto(row: ProLabRow) {
    return {
      proLabId: row.proLabId,
      labId: row.labId,
      networkIpRange: row.networkIpRange,
      totalMachines: row.totalMachines,
      requiredRootCount: row.requiredRootCount,
      checkpoints: Object.entries(row.flagValues ?? {}).map(([checkpointId, assertionGroupId]) => ({
        checkpointId,
        assertionGroupId,
      })),
      activeUsersCount: row.activeUsersCount,
    };
  }

  private toSherlockDto(row: SherlockRow) {
    return {
      sherlockId: row.sherlockId,
      labId: row.labId,
      evidenceFileUrl: row.evidenceFileUrl,
      evidenceFileSize: row.evidenceFileSize,
      fileHash: row.fileHash,
      questions: (row.questions ?? []).map((question) => ({
        id: question.id,
        text: question.text,
        hint: question.hint ?? null,
      })),
      requiredCorrectAnswers: row.requiredCorrectAnswers,
    };
  }
}

export const labService = new LabService();