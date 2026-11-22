import { env } from '../../../app/config';
import { AppError, ConflictError, ERROR_CODES, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { redisClient, cacheKeys } from '../../../app/cache/redis';
import { activityLogService } from '../../progress/services/ActivityLogService';
import { awardService, type AwardService } from '../../gamification/services/award.service';
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
import type { LabCheckService } from './LabCheckService';
import { labCheckService, scalePoints } from './LabCheckService';
import type { InstanceRow, LabsRepository, LabRow, SherlockRow } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';
import { parseLabSpec } from '../validators/lab-spec.validator';

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
    | 'insertActivity'
    | 'updateInstanceStatus'
    | 'updateInstanceExpiry'
    | 'updateInstanceEndpoint'
    | 'hasLabCompletionEvent'
    | 'getPointsMultiplier'
  >;
  orchestration: Pick<
    ContainerOrchestrationAdapter,
    'createInstance' | 'stopInstance' | 'terminateInstance' | 'getInstance'
  >;
  entitlement: Pick<EntitlementService, 'assertLabAccess' | 'getLabTtlHours' | 'getExtensionLimit'>;
  vpn: Pick<VpnService, 'ensureAssignmentForProvision' | 'releaseAssignmentForUser'>;
  award: Pick<AwardService, 'withUserLock'>;
  check: Pick<LabCheckService, 'runSetup'>;
  maxExtensions: number;
  extendMinutes: number;
}

function defaultDeps(): LabServiceDeps {
  return {
    repo: labsRepository,
    orchestration: containerOrchestrationAdapter,
    entitlement: entitlementService,
    vpn: vpnService,
    award: awardService,
    check: labCheckService,
    maxExtensions: env.LAB_MAX_EXTENSIONS,
    extendMinutes: env.LAB_EXTEND_MINUTES,
  };
}

function labNotFound(): NotFoundError {
  return new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
}

export interface ProvisionOptions {
  /** Admin test-check flow (contracts 6.2): provisions draft labs and labs without a v2 spec. */
  allowInactive?: boolean;
}

/**
 * F6 §08 lab instance lifecycle: provision, stop, terminate, extend, active
 * status and the lab catalog. Every learner-scoped operation resolves the
 * instance through `user_id = session.userId` (IDOR mitigation); the F9
 * entitlement gate runs before provisioning; no root credential is
 * generated or returned (D27), and lab detail never exposes the stored
 * step spec beyond the allowlisted step summary (D21).
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
      throw labNotFound();
    }
    const [proLab, sherlock, multiplier] = await Promise.all([
      this.deps.repo.findProLabByLabId(labId),
      this.deps.repo.findSherlockByLabId(labId),
      this.deps.repo.getPointsMultiplier(labId),
    ]);
    const [isStarted, isCompleted] = userId === null
      ? [false, false]
      : await Promise.all([
          this.deps.repo.findActiveInstanceForUser(userId, labId).then((row) => row !== null),
          this.deps.repo.hasLabCompletionEvent(userId, labId),
        ]);

    // D21: allowlist only. Checks, setup scripts, accepted answers and hints
    // stay on the server; a spec that is not runnable v2 exposes no steps.
    const parsed = proLab ? parseLabSpec(proLab.flagValues) : null;
    if (parsed?.kind === 'invalid') {
      logger.error({ labId, issues: parsed.issues }, 'Stored lab spec failed validation');
    }
    const spec = parsed?.kind === 'v2' ? parsed.spec : null;
    const steps = (spec?.steps ?? []).map((step, index) => ({
      stepId: step.id,
      position: index + 1,
      title: step.title,
      kind: step.kind,
      points: scalePoints(step.points, multiplier),
    }));
    const pointsAvailable = spec
      ? steps.reduce((sum, step) => sum + step.points, 0) + scalePoints(spec.completionBonus, multiplier)
      : 0;

    return {
      ...this.toLabDto(lab),
      isStarted,
      isCompleted,
      mode: spec?.mode ?? null,
      scenarioIntro: spec?.scenario.intro ?? '',
      stepCount: steps.length,
      pointsAvailable,
      steps,
      sherlock: sherlock ? this.toSherlockDto(sherlock) : null,
    };
  }

  /* ── Provision (LAB-03) ───────────────────────────────────────────────── */

  async provisionInstance(
    userId: number,
    labId: number,
    region: VpnRegion | null,
    opts: ProvisionOptions = {},
  ): Promise<ProvisionInstanceDto> {
    const allowInactive = opts.allowInactive === true;
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || (!lab.isActive && !allowInactive)) {
      throw labNotFound();
    }

    const parsed = parseLabSpec((await this.deps.repo.findProLabByLabId(labId))?.flagValues ?? null);
    if (!allowInactive && parsed.kind !== 'v2') {
      if (parsed.kind === 'invalid') {
        logger.error({ labId, issues: parsed.issues }, 'Stored lab spec failed validation');
        throw new ConflictError('This lab is misconfigured.', [{ code: ERROR_CODES.LAB_MISCONFIGURED }]);
      }
      throw new ConflictError('This lab is not ready yet.', [{ code: ERROR_CODES.LAB_NOT_READY }]);
    }
    const setupCommands = parsed.kind === 'v2' ? parsed.spec.scenario.setup : [];

    try {
      await this.deps.entitlement.assertLabAccess(userId, labId);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw new ForbiddenError(error.message, [{ code: ERROR_CODES.LAB_ACCESS_DENIED }]);
      }
      throw error;
    }

    const ttlHours = await this.deps.entitlement.getLabTtlHours(userId);
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    // Idempotent per user and runs before the lock: it must not hold the users row lock (contracts 0.3).
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

    const isPro = lab.labType === 'pro_lab';
    const ramGb = isPro ? 4 : 2;
    const cpuCores = isPro ? 4 : 2;
    const diskGb = isPro ? 30 : 20;

    // Check-then-insert under the user lock (contracts 0.3, 4.1): any live instance blocks a new one.
    const instanceId = await this.deps.award.withUserLock(userId, async (tx) => {
      const active = await this.deps.repo.findAnyActiveInstanceForUser(userId, tx);
      if (active) {
        throw new ConflictError('You already have an active lab environment. Terminate it first.', [
          { code: ERROR_CODES.INSTANCE_ALREADY_ACTIVE, instanceId: active.instanceId, labId: active.labId },
        ]);
      }

      // No root credential is generated or stored: the container never used it (D27).
      const id = await this.deps.repo.insertInstance(
        {
          userId,
          vpnId: assignment.vpnId,
          hostname: null,
          assignedIp: null,
          sshPort: 22,
          ramGb,
          cpuCores,
          diskGb,
          status: 'pending',
          expiresAt,
        },
        tx,
      );
      // Written in the same transaction so a crash never leaves a pending instance without its lab mapping.
      await this.deps.repo.insertActivity(
        {
          userId,
          activityType: 'LAB_STARTED',
          details: {
            labId,
            labSlug: lab.slug,
            labType: lab.labType,
            instanceId: id,
            region: region ?? null,
          },
        },
        tx,
      );
      return id;
    });

    // Network work happens after the commit and never under the lock (contracts 0.3).
    let hostname: string | null = null;
    let assignedIp: string | null = null;
    let sshPort = 22;
    let terminalWsUrl = '';
    try {
      const endpoint = await this.deps.orchestration.createInstance({
        labId,
        // Labs resolves the container image by catalog slug (contracts 6.3, 7.1).
        labSlug: lab.slug,
        instanceId,
        ramGb,
        cpuCores,
        diskGb,
      });
      hostname = endpoint.hostname;
      assignedIp = endpoint.assignedIp;
      sshPort = endpoint.sshPort;
      terminalWsUrl = endpoint.terminalWsUrl;
      if (setupCommands.length > 0) {
        await this.deps.check.runSetup(instanceId, setupCommands);
      }
      await this.deps.repo.updateInstanceEndpoint(instanceId, {
        hostname,
        assignedIp,
        sshPort,
      });
      await this.deps.repo.updateInstanceStatus(instanceId, 'running');
    } catch (error) {
      await this.abandonProvision(userId, labId, instanceId, error);
      throw new AppError(
        'The lab environment could not be provisioned. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      instanceId,
      labId,
      labSlug: lab.slug,
      status: 'running',
      hostname,
      assignedIp,
      sshPort,
      terminalWsUrl,
      expiresAt: expiresAt.toISOString(),
      vpnAssignment: { ovpnConfigUrl: assignment.ovpnConfigUrl },
    };
  }

  /** Rolls back a failed provision: container removed (best effort), status `error`, VPN released. */
  private async abandonProvision(userId: number, labId: number, instanceId: number, error: unknown): Promise<void> {
    logger.error({ err: error, userId, labId, instanceId }, 'Lab provisioning failed');
    try {
      await this.deps.orchestration.terminateInstance(instanceId);
    } catch (cleanupError) {
      logger.error({ err: cleanupError, instanceId }, 'Lab cleanup after failed provisioning failed');
    }
    try {
      await this.deps.repo.updateInstanceStatus(instanceId, 'error');
    } catch (statusError) {
      logger.error({ err: statusError, instanceId }, 'Could not mark the failed lab instance as error');
    }
    try {
      await this.deps.vpn.releaseAssignmentForUser(userId);
    } catch (vpnError) {
      logger.error({ err: vpnError, userId, instanceId }, 'VPN release after failed provisioning failed');
    }
  }

  /* ── Active instance (LAB-04) ─────────────────────────────────────────── */

  async getActiveInstance(userId: number): Promise<ActiveInstanceDto | null> {
    const row = await this.deps.repo.findAnyActiveInstanceForUser(userId);
    if (!row || !row.labId) {
      return null;
    }
    const lab = await this.deps.repo.findLabById(row.labId);

    // Null when the orchestrator cannot resolve the environment: the FE shows the reconnect state (D11).
    let terminalWsUrl: string | null = null;
    try {
      const endpoint = await this.deps.orchestration.getInstance(row.instanceId);
      terminalWsUrl = endpoint?.terminalWsUrl ?? null;
    } catch (err) {
      logger.warn({ err, instanceId: row.instanceId }, 'Could not resolve terminal endpoint from orchestrator');
    }

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
      terminalWsUrl,
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
      throw new NotFoundError('Lab instance not found.', [{ code: ERROR_CODES.INSTANCE_NOT_FOUND }]);
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