import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { auditLogService } from '../../admin/services/audit-log.service';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import type {
  AdminLabDto,
  AdminTrackDto,
  CreateLabInput,
  CreateTrackInput,
  LabInstanceStatus,
  LabType,
  UpdateLabInput,
  UpdateTrackInput,
} from '../dto/labs.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminLabServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'listLabs'
    | 'listAllInstances'
    | 'insertLab'
    | 'updateLab'
    | 'setLabActive'
    | 'findLabById'
    | 'findLabBySlug'
    | 'insertProLab'
    | 'insertSherlock'
    | 'updateProLab'
    | 'updateSherlock'
    | 'listTracks'
    | 'findTrackById'
    | 'insertTrack'
    | 'updateTrack'
    | 'replaceTrackContent'
    | 'findInstanceById'
    | 'updateInstanceStatus'
  >;
  orchestration: Pick<ContainerOrchestrationAdapter, 'terminateInstance'>;
}

function defaultDeps(): AdminLabServiceDeps {
  return { repo: labsRepository, orchestration: containerOrchestrationAdapter };
}

function crashAudit(
  actor: AdminActor,
  action: string,
  targetType: string,
  targetId: number,
  changes: Record<string, unknown>,
): void {
  void auditLogService
    .record({
      adminUserId: actor.userId,
      action,
      targetType,
      targetId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    })
    .catch(() => undefined);
}

/**
 * F6 §08 admin surface (LAB-11..LAB-20): lab/track CRUD with duplicate-slug
 * protection, pro-lab/sherlock config handling, and instance lifecycle
 * control. Every mutation is audited (F2 audit_logs pattern). Gated by the
 * `platform.labs.manage` / `platform.labs.admin` permissions at the router.
 */
export class AdminLabService {
  constructor(private readonly deps: AdminLabServiceDeps = defaultDeps()) {}

  /* ── Lab catalog administration ──────────────────────────────────────── */

  async listLabsAdmin(): Promise<AdminLabDto[]> {
    const rows = await this.deps.repo.listLabs(true);
    return rows.map((row) => this.toAdminLabDto(row));
  }

  async createLab(actor: AdminActor, input: CreateLabInput): Promise<AdminLabDto> {
    await this.assertSlugAvailable(input.slug);
    const labId = await this.deps.repo.insertLab({
      labName: input.labName,
      slug: input.slug,
      description: input.description ?? null,
      difficultyId: input.difficultyId,
      categoryId: input.categoryId ?? null,
      labType: input.labType,
      isPremium: input.isPremium ?? false,
      estimatedHours: input.estimatedHours ?? 0,
      networkDiagramUrl: input.networkDiagramUrl ?? null,
    });

    if (input.labType === 'pro_lab' && input.proLabConfig) {
      await this.deps.repo.insertProLab({
        labId,
        networkIpRange: input.proLabConfig.networkIpRange,
        totalMachines: input.proLabConfig.totalMachines,
        requiredRootCount: input.proLabConfig.requiredRootCount,
        flagValues: input.proLabConfig.flagValues ?? null,
      });
    }
    if (input.labType === 'sherlock' && input.sherlockConfig) {
      await this.deps.repo.insertSherlock({
        labId,
        evidenceFileUrl: input.sherlockConfig.evidenceFileUrl ?? null,
        evidenceFileSize: input.sherlockConfig.evidenceFileSize ?? null,
        fileHash: input.sherlockConfig.fileHash ?? null,
        questions: input.sherlockConfig.questions ?? [],
        answers: input.sherlockConfig.answers ?? [],
        requiredCorrectAnswers: input.sherlockConfig.requiredCorrectAnswers,
      });
    }

    crashAudit(actor, AUDIT_ACTIONS.CREATE_LAB, 'lab', labId, {
      labName: input.labName,
      slug: input.slug,
      labType: input.labType,
    });
    const created = await this.deps.repo.findLabById(labId);
    return this.toAdminLabDto(
      created ?? {
        labId,
        labName: input.labName,
        slug: input.slug,
        description: input.description ?? null,
        difficultyId: input.difficultyId,
        difficultyName: null,
        categoryId: input.categoryId ?? null,
        categoryName: null,
        labType: input.labType,
        isActive: true,
        isPremium: input.isPremium ?? false,
        estimatedHours: input.estimatedHours ?? 0,
        networkDiagramUrl: input.networkDiagramUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
  }

  async updateLab(actor: AdminActor, labId: number, input: UpdateLabInput): Promise<AdminLabDto> {
    if (input.slug) {
      const existing = await this.deps.repo.findLabBySlug(input.slug);
      if (existing && existing.labId !== labId) {
        throw new ConflictError('A lab with this slug already exists.');
      }
    }
    const before = await this.deps.repo.findLabById(labId);
    if (!before) {
      throw new NotFoundError('Lab not found.');
    }

    const patch = {
      labName: input.labName,
      slug: input.slug,
      description: input.description,
      difficultyId: input.difficultyId,
      categoryId: input.categoryId,
      isPremium: input.isPremium,
      estimatedHours: input.estimatedHours,
      networkDiagramUrl: input.networkDiagramUrl,
    };
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    await this.deps.repo.updateLab(labId, definedPatch);

    if (input.proLabConfig) {
      await this.deps.repo.updateProLab(labId, {
        networkIpRange: input.proLabConfig.networkIpRange,
        totalMachines: input.proLabConfig.totalMachines,
        requiredRootCount: input.proLabConfig.requiredRootCount,
        flagValues: input.proLabConfig.flagValues,
      });
    }
    if (input.sherlockConfig) {
      await this.deps.repo.updateSherlock(labId, {
        evidenceFileUrl: input.sherlockConfig.evidenceFileUrl ?? null,
        evidenceFileSize: input.sherlockConfig.evidenceFileSize ?? null,
        fileHash: input.sherlockConfig.fileHash ?? null,
        questions: input.sherlockConfig.questions,
        answers: input.sherlockConfig.answers,
        requiredCorrectAnswers: input.sherlockConfig.requiredCorrectAnswers,
      });
    }

    crashAudit(actor, AUDIT_ACTIONS.UPDATE_LAB, 'lab', labId, definedPatch);
    const updated = await this.deps.repo.findLabById(labId);
    if (!updated) {
      throw new NotFoundError('Lab not found.');
    }
    return this.toAdminLabDto(updated);
  }

  async publishLab(
    actor: AdminActor,
    labId: number,
    isActive: boolean,
  ): Promise<{ labId: number; isActive: boolean }> {
    const before = await this.deps.repo.findLabById(labId);
    if (!before) {
      throw new NotFoundError('Lab not found.');
    }
    await this.deps.repo.setLabActive(labId, isActive);
    crashAudit(actor, AUDIT_ACTIONS.PUBLISH_LAB, 'lab', labId, { isActive });
    return { labId, isActive };
  }

  /* ── Track administration ────────────────────────────────────────────── */

  async listTracksAdmin(): Promise<AdminTrackDto[]> {
    const rows = await this.deps.repo.listTracks(true);
    return rows.map((row) => this.toAdminTrackDto(row));
  }

  async createTrack(actor: AdminActor, input: CreateTrackInput): Promise<AdminTrackDto> {
    const trackId = await this.deps.repo.insertTrack({
      trackName: input.trackName,
      slug: input.slug,
      description: input.description ?? null,
      difficultyId: input.difficultyId ?? 1,
      categoryId: input.categoryId ?? null,
      totalLabs: input.totalLabs,
      isPremium: input.isPremium ?? false,
    });
    if (input.content && input.content.length > 0) {
      await this.deps.repo.replaceTrackContent(trackId, input.content);
    }
    crashAudit(actor, AUDIT_ACTIONS.CREATE_TRACK, 'track', trackId, {
      trackName: input.trackName,
      slug: input.slug,
    });
    const created = await this.deps.repo.findTrackById(trackId);
    return this.toAdminTrackDto(
      created ?? {
        trackId,
        trackName: input.trackName,
        slug: input.slug,
        description: input.description ?? null,
        difficultyId: input.difficultyId ?? 1,
        difficultyName: null,
        categoryId: input.categoryId ?? null,
        categoryName: null,
        totalLabs: input.totalLabs,
        isActive: true,
        isPremium: input.isPremium ?? false,
        createdAt: new Date(),
      },
    );
  }

  async updateTrack(actor: AdminActor, trackId: number, input: UpdateTrackInput): Promise<AdminTrackDto> {
    const before = await this.deps.repo.findTrackById(trackId);
    if (!before) {
      throw new NotFoundError('Track not found.');
    }
    const patch = {
      trackName: input.trackName,
      slug: input.slug,
      description: input.description,
      difficultyId: input.difficultyId,
      categoryId: input.categoryId,
      totalLabs: input.totalLabs,
      isActive: input.isActive,
      isPremium: input.isPremium,
    };
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    await this.deps.repo.updateTrack(trackId, definedPatch);
    if (input.content) {
      await this.deps.repo.replaceTrackContent(trackId, input.content);
    }
    crashAudit(actor, AUDIT_ACTIONS.UPDATE_TRACK, 'track', trackId, definedPatch);
    const updated = await this.deps.repo.findTrackById(trackId);
    if (!updated) {
      throw new NotFoundError('Track not found.');
    }
    return this.toAdminTrackDto(updated);
  }

  private toAdminTrackDto(row: {
    trackId: number;
    trackName: string;
    slug: string;
    description: string | null;
    difficultyId: number | null;
    difficultyName: string | null;
    categoryId: number | null;
    categoryName: string | null;
    totalLabs: number;
    isActive: boolean;
    isPremium: boolean;
    createdAt: Date;
  }): AdminTrackDto {
    return {
      trackId: row.trackId,
      trackName: row.trackName,
      slug: row.slug,
      description: row.description,
      difficultyId: row.difficultyId,
      difficultyName: row.difficultyName,
      estimatedHours: row.totalLabs * 2,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /* ── Instance administration ─────────────────────────────────────────── */

  async listInstancesAdmin(
    page: number,
    pageSize: number,
    filters: { status?: LabInstanceStatus; search?: string } = {},
  ): Promise<{ instances: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
    const result = await this.deps.repo.listAllInstances(
      page,
      pageSize,
      filters.status ?? null,
      filters.search ?? null,
    );
    return {
      instances: result.rows.map((instance) => ({
        instanceId: instance.instanceId,
        userId: instance.userId,
        username: instance.username,
        labId: instance.labId,
        labName: instance.labName,
        labType: instance.labType,
        hostname: instance.hostname,
        assignedIp: instance.assignedIp,
        sshPort: instance.sshPort,
        ramGb: instance.ramGb,
        cpuCores: instance.cpuCores,
        diskGb: instance.diskGb,
        status: instance.status,
        startedAt: instance.startedAt.toISOString(),
        expiresAt: instance.expiresAt?.toISOString() ?? null,
        terminatedAt: instance.terminatedAt?.toISOString() ?? null,
        vpnId: instance.vpnId,
      })),
      total: result.total,
      page,
      pageSize,
    };
  }

  async terminateInstanceAdmin(
    actor: AdminActor,
    instanceId: number,
    reason = 'terminated by administrator',
  ): Promise<{ instanceId: number; status: 'terminated' }> {
    const instance = await this.deps.repo.findInstanceById(instanceId);
    if (!instance) {
      throw new NotFoundError('Lab instance not found.');
    }
    try {
      await this.deps.orchestration.terminateInstance(instanceId);
    } catch (error) {
      logger.error({ err: error, instanceId }, 'Admin lab terminate failed');
      throw new BadRequestError('The lab environment could not be terminated.');
    }
    await this.deps.repo.updateInstanceStatus(instanceId, 'terminated');
    crashAudit(actor, AUDIT_ACTIONS.TERMINATE_INSTANCE, 'pwnbox_instance', instanceId, { reason });
    return { instanceId, status: 'terminated' };
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  private async assertSlugAvailable(slug: string): Promise<void> {
    const existing = await this.deps.repo.findLabBySlug(slug);
    if (existing) {
      throw new ConflictError('A lab with this slug already exists.');
    }
  }

  private toAdminLabDto(row: {
    labId: number;
    labName: string;
    slug: string;
    description: string | null;
    difficultyId: number;
    difficultyName: string | null;
    categoryId: number | null;
    categoryName: string | null;
    labType: LabType;
    isActive: boolean;
    isPremium: boolean;
    estimatedHours: number;
    networkDiagramUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): AdminLabDto {
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const adminLabService = new AdminLabService();