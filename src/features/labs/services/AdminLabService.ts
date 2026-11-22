import { and, asc, eq, inArray, max, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../../app/database';
import {
  academyCourses,
  activityLogs,
  labs,
  lessons,
  modules,
  proLabs,
  sherlocks,
  trackContent,
  tracks,
} from '../../../app/database/schema';
import { BadRequestError, ConflictError, ERROR_CODES, NotFoundError, ValidationError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { auditLogService } from '../../admin/services/audit-log.service';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import { ITEM_SLUG_RE } from '../../../shared/utils/curriculum-slug';
import type {
  AdminCheckResultDto,
  AdminLabDetailDto,
  AdminLabDto,
  AdminLabUsageDto,
  AdminTrackContentDto,
  AdminTrackDetailDto,
  AdminTrackDto,
  CatalogLabDto,
  CreateLabInput,
  CreateTrackInput,
  LabInstanceStatus,
  LabSpecStatus,
  UpdateLabInput,
  UpdateTrackInput,
} from '../dto/labs.dto';
import type { LabSpecIssue, LabSpecV2, LabStepCheck } from '../dto/lab-spec.dto';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { CatalogImportService } from './CatalogImportService';
import { catalogImportService } from './CatalogImportService';
import type { LabCheckService } from './LabCheckService';
import { labCheckService } from './LabCheckService';
import type { LabRow, LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';
import { labSpecV2Schema, lintLabSpec, parseLabSpec, toLabSpecIssues } from '../validators/lab-spec.validator';

export interface AdminActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminLabServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'listLabs'
    | 'findLabById'
    | 'countLabUsage'
    | 'setLabActive'
    | 'listAllInstances'
    | 'findInstanceById'
    | 'findInstanceForUser'
    | 'updateInstanceStatus'
  >;
  orchestration: Pick<ContainerOrchestrationAdapter, 'terminateInstance' | 'listCatalog' | 'getCatalogLab'>;
  catalog: Pick<CatalogImportService, 'importLab'>;
  checks: Pick<LabCheckService, 'evaluate'>;
}

function defaultDeps(): AdminLabServiceDeps {
  return {
    repo: labsRepository,
    orchestration: containerOrchestrationAdapter,
    catalog: catalogImportService,
    checks: labCheckService,
  };
}

/** Validated v2 spec as stored in `pro_labs.flag_values` (zod output, JSON-column compatible). */
type StoredLabSpec = z.output<typeof labSpecV2Schema>;

/** Transaction handle (same alias as the labs repository and CatalogImportService). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The shared pool handle or a transaction handle. */
type DbOrTx = typeof db | Tx;

/** Network range written to every `pro_labs` row (same as the catalog import). */
const LAB_NETWORK_IP_RANGE = '172.17.0.0/16';

/** Admin test-check output is truncated; the full output is never returned or stored. */
const CHECK_OUTPUT_MAX_CHARACTERS = 4096;

export interface LabSpecValidationResult {
  valid: boolean;
  issues: LabSpecIssue[];
  warnings: string[];
}

export interface AdminTestCheckInput {
  instanceId: number;
  stepId?: string;
  check?: LabStepCheck;
}

/** Stored spec read: `parseLabSpec` outcome flattened for the admin DTOs. */
interface StoredSpecState {
  status: LabSpecStatus;
  spec: LabSpecV2 | null;
  issues: LabSpecIssue[];
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
    .catch((err: unknown) => logger.warn({ err, action }, 'Audit write failed'));
}

/** MySQL duplicate key (`ER_DUP_ENTRY`), also when wrapped by the query layer. */
function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const cause = (error as { cause?: unknown }).cause;
  return code === 'ER_DUP_ENTRY' || (cause !== undefined && isDuplicateKeyError(cause));
}

function truncateOutput(value: string): string {
  return value.length > CHECK_OUTPUT_MAX_CHARACTERS ? value.slice(0, CHECK_OUTPUT_MAX_CHARACTERS) : value;
}

function readStoredSpec(raw: unknown): StoredSpecState {
  const parsed = parseLabSpec(raw);
  switch (parsed.kind) {
    case 'v2':
      return { status: 'v2', spec: parsed.spec, issues: [] };
    case 'legacy':
      return { status: 'legacy', spec: null, issues: [] };
    case 'missing':
      return { status: 'missing', spec: null, issues: [] };
    case 'invalid':
      return { status: 'invalid', spec: null, issues: parsed.issues };
  }
}

/** Zod-validates an admin spec; a failure is 422 `LAB_SPEC_INVALID` with the issues after the code. */
function parseStoredSpec(raw: unknown): StoredLabSpec {
  const parsed = labSpecV2Schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('The lab spec is invalid.', [
      { code: ERROR_CODES.LAB_SPEC_INVALID },
      ...toLabSpecIssues(parsed.error),
    ]);
  }
  return parsed.data;
}

/**
 * F6 §08 admin surface (contracts §6.2): lab catalog administration, the step
 * spec editor, the publish gate, test checks, track curation and instance
 * control. Every mutation is audited with the `crashAudit` pattern. Gated by
 * `platform.labs.manage` / `platform.labs.admin` at the router.
 */
export class AdminLabService {
  constructor(private readonly deps: AdminLabServiceDeps = defaultDeps()) {}

  /* ── Lab catalog administration ──────────────────────────────────────── */

  async listLabs(): Promise<AdminLabDto[]> {
    const rows = await this.deps.repo.listLabs(true);
    return Promise.all(
      rows.map(async (row) => {
        const [stored, usage] = await Promise.all([
          this.loadStoredSpec(row.labId),
          this.deps.repo.countLabUsage(row.labId),
        ]);
        return this.toAdminLabDto(row, stored, usage);
      }),
    );
  }

  /** Alias kept for `AdminLabController` until the admin labs router replaces it. */
  async listLabsAdmin(): Promise<AdminLabDto[]> {
    return this.listLabs();
  }

  async getLab(labId: number): Promise<AdminLabDetailDto> {
    const row = await this.requireLab(labId);
    const [stored, usage] = await Promise.all([
      this.loadStoredSpec(labId),
      this.deps.repo.countLabUsage(labId),
    ]);
    return {
      ...this.toAdminLabDto(row, stored, usage),
      spec: stored.spec,
      specIssues: stored.issues,
    };
  }

  /** Labs catalog entries joined to the imported labs (`importedLabId` by slug). */
  async catalog(unusedOnly: boolean): Promise<CatalogLabDto[]> {
    const [entries, labRows] = await Promise.all([
      this.deps.orchestration.listCatalog(),
      this.deps.repo.listLabs(true),
    ]);
    const importedBySlug = new Map(labRows.map((row) => [row.slug, row.labId]));
    const dtos: CatalogLabDto[] = entries.map((entry) => {
      const importedLabId = importedBySlug.get(entry.slug) ?? null;
      return {
        slug: entry.slug,
        courseSlug: entry.courseSlug,
        moduleSlug: entry.moduleSlug,
        moduleTitle: entry.moduleTitle,
        manifestLabId: entry.labId,
        title: entry.title,
        description: entry.description,
        difficulty: entry.difficulty,
        category: entry.category,
        estimatedHours: entry.estimatedHours,
        dockerImage: entry.dockerImage,
        stepCount: entry.stepCount,
        steps: entry.steps.map((step) => ({ id: step.id, title: step.title, kind: step.kind })),
        importedLabId,
        isUsed: importedLabId !== null,
      };
    });
    return unusedOnly ? dtos.filter((dto) => !dto.isUsed) : dtos;
  }

  /** Imports one catalog lab as a draft (never activated here; activation is the publish gate). */
  async importFromCatalog(
    actor: AdminActor,
    slug: string,
  ): Promise<{ lab: AdminLabDetailDto; created: boolean }> {
    const result = await this.deps.catalog.importLab(slug, { activateNewLabs: false });
    crashAudit(actor, AUDIT_ACTIONS.IMPORT_LAB, 'lab', result.labId, {
      slug: result.slug,
      created: result.created,
      stepCount: result.stepCount,
    });
    const lab = await this.getLab(result.labId);
    return { lab, created: result.created };
  }

  /** Live editor validation. Never throws: invalid input is reported as issues. */
  validateSpec(raw: unknown): LabSpecValidationResult {
    const parsed = labSpecV2Schema.safeParse(raw);
    if (!parsed.success) {
      return { valid: false, issues: toLabSpecIssues(parsed.error), warnings: [] };
    }
    return { valid: true, issues: [], warnings: lintLabSpec(parsed.data) };
  }

  /**
   * Saves the step spec (upserts `pro_labs`). Warns when a saved step id
   * disappears while learners have passed it: renaming resets that step for everyone.
   */
  async saveSpec(
    actor: AdminActor,
    labId: number,
    rawSpec: unknown,
  ): Promise<{ lab: AdminLabDetailDto; warnings: string[] }> {
    const lab = await this.requireLab(labId);
    if (lab.labType === 'sherlock') {
      throw new ValidationError('Sherlock labs do not have a step spec.');
    }
    const spec = parseStoredSpec(rawSpec);
    const previous = await this.loadStoredSpec(labId);
    const removedWarnings = await this.removedStepWarnings(labId, previous.spec, spec);
    const warnings = [...removedWarnings, ...lintLabSpec(spec)];

    await this.upsertProLabRow(db, {
      labId,
      networkIpRange: LAB_NETWORK_IP_RANGE,
      totalMachines: 1,
      spec,
    });
    crashAudit(actor, AUDIT_ACTIONS.SAVE_LAB_SPEC, 'lab', labId, {
      stepCount: spec.steps.length,
      warningCount: warnings.length,
    });
    return { lab: await this.getLab(labId), warnings };
  }

  /**
   * Publish gate. Activating needs a valid v2 spec (409 `LAB_NOT_READY`) and a
   * slug the Labs catalog can provision (409 `CATALOG_LAB_NOT_FOUND`; an
   * unreachable catalog propagates as 503 `CATALOG_UNAVAILABLE`).
   */
  async setActive(
    actor: AdminActor,
    labId: number,
    isActive: boolean,
  ): Promise<{ labId: number; isActive: boolean }> {
    const lab = await this.requireLab(labId);
    if (isActive) {
      const stored = await this.loadStoredSpec(labId);
      if (stored.status !== 'v2') {
        throw new ConflictError('The lab spec is not ready.', [{ code: ERROR_CODES.LAB_NOT_READY }]);
      }
      await this.assertCatalogLab(lab.slug);
    }
    await this.deps.repo.setLabActive(labId, isActive);
    crashAudit(actor, AUDIT_ACTIONS.PUBLISH_LAB, 'lab', labId, { isActive });
    return { labId, isActive };
  }

  /** Alias kept for `AdminLabController` until the admin labs router replaces it. */
  async publishLab(
    actor: AdminActor,
    labId: number,
    isActive: boolean,
  ): Promise<{ labId: number; isActive: boolean }> {
    return this.setActive(actor, labId, isActive);
  }

  /** One transaction for `labs` and its `pro_labs` or `sherlocks` row (D13). */
  async createLab(actor: AdminActor, input: CreateLabInput): Promise<AdminLabDetailDto> {
    if (input.labType === 'sherlock' && input.spec !== undefined) {
      throw new ValidationError('Sherlock labs do not have a step spec.');
    }
    const spec = input.spec === undefined ? null : parseStoredSpec(input.spec);
    await this.assertLabIdentityAvailable(input.slug, input.labName);

    const labId = await this.runLabWrite(async (tx) => {
      const inserted = await tx.insert(labs).values({
        labName: input.labName,
        slug: input.slug,
        description: input.description ?? null,
        difficultyId: input.difficultyId,
        categoryId: input.categoryId ?? null,
        labType: input.labType,
        isActive: false,
        isPremium: input.isPremium ?? false,
        estimatedHours: input.estimatedHours ?? 0,
        networkDiagramUrl: input.networkDiagramUrl ?? null,
      });
      const newLabId = inserted[0]?.insertId;
      if (!newLabId) {
        throw new Error('Failed to create lab.');
      }

      if (input.labType === 'sherlock') {
        if (input.sherlockConfig) {
          await tx.insert(sherlocks).values({
            labId: newLabId,
            evidenceFileUrl: input.sherlockConfig.evidenceFileUrl ?? null,
            evidenceFileSize: input.sherlockConfig.evidenceFileSize ?? null,
            fileHash: input.sherlockConfig.fileHash ?? null,
            questions: input.sherlockConfig.questions,
            answers: input.sherlockConfig.answers,
            requiredCorrectAnswers: input.sherlockConfig.requiredCorrectAnswers,
          });
        }
      } else {
        await this.upsertProLabRow(tx, {
          labId: newLabId,
          networkIpRange: input.proLabConfig?.networkIpRange ?? LAB_NETWORK_IP_RANGE,
          totalMachines: input.proLabConfig?.totalMachines ?? 1,
          spec,
        });
      }
      return newLabId;
    });

    crashAudit(actor, AUDIT_ACTIONS.CREATE_LAB, 'lab', labId, {
      labName: input.labName,
      slug: input.slug,
      labType: input.labType,
    });
    return this.getLab(labId);
  }

  /** Lab row and its config row in one transaction. `requiredRootCount` is owned by the spec. */
  async updateLab(actor: AdminActor, labId: number, input: UpdateLabInput): Promise<AdminLabDetailDto> {
    const before = await this.requireLab(labId);
    if (input.proLabConfig && before.labType === 'sherlock') {
      throw new ValidationError('proLabConfig does not apply to sherlock labs.');
    }
    if (input.sherlockConfig && before.labType !== 'sherlock') {
      throw new ValidationError('sherlockConfig applies only to sherlock labs.');
    }
    if (input.slug !== undefined || input.labName !== undefined) {
      await this.assertLabIdentityAvailable(
        input.slug ?? before.slug,
        input.labName ?? before.labName,
        labId,
      );
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

    await this.runLabWrite(async (tx) => {
      if (Object.keys(definedPatch).length > 0) {
        await tx.update(labs).set(definedPatch).where(eq(labs.labId, labId));
      }
      if (input.proLabConfig) {
        await tx
          .insert(proLabs)
          .values({
            labId,
            networkIpRange: input.proLabConfig.networkIpRange,
            totalMachines: input.proLabConfig.totalMachines,
            requiredRootCount: 0,
          })
          .onDuplicateKeyUpdate({
            set: {
              networkIpRange: input.proLabConfig.networkIpRange,
              totalMachines: input.proLabConfig.totalMachines,
            },
          });
      }
      if (input.sherlockConfig) {
        await tx
          .update(sherlocks)
          .set({
            evidenceFileUrl: input.sherlockConfig.evidenceFileUrl ?? null,
            evidenceFileSize: input.sherlockConfig.evidenceFileSize ?? null,
            fileHash: input.sherlockConfig.fileHash ?? null,
            questions: input.sherlockConfig.questions,
            answers: input.sherlockConfig.answers,
            requiredCorrectAnswers: input.sherlockConfig.requiredCorrectAnswers,
          })
          .where(eq(sherlocks.labId, labId));
      }
      return labId;
    });

    crashAudit(actor, AUDIT_ACTIONS.UPDATE_LAB, 'lab', labId, definedPatch);
    return this.getLab(labId);
  }

  /** Refused while any module item uses the lab or learners have LAB_* events on it. */
  async deleteLab(actor: AdminActor, labId: number): Promise<{ labId: number }> {
    const lab = await this.requireLab(labId);
    const usage = await this.deps.repo.countLabUsage(labId);
    if (usage.itemIds.length > 0) {
      throw new ConflictError('The lab is used by a module item.', [{ code: ERROR_CODES.LAB_IN_USE }]);
    }
    if (usage.activeInstances > 0 || usage.learnersWithProgress > 0) {
      throw new ConflictError('The lab has learner data and cannot be deleted.', [
        { code: ERROR_CODES.LAB_HAS_LEARNER_DATA },
      ]);
    }
    await db.delete(labs).where(eq(labs.labId, labId));
    crashAudit(actor, AUDIT_ACTIONS.DELETE_LAB, 'lab', labId, {
      slug: lab.slug,
      labName: lab.labName,
    });
    return { labId };
  }

  /**
   * Runs one check against a running instance and returns the outcome. Never
   * writes `LAB_STEP_*` or ledger rows. `hasLabsAdmin` is the caller's
   * `PLATFORM_LABS_ADMIN` permission: without it the instance must be the caller's own.
   */
  async testCheck(
    actor: AdminActor,
    labId: number,
    input: AdminTestCheckInput,
    hasLabsAdmin: boolean,
  ): Promise<{ result: AdminCheckResultDto }> {
    await this.requireLab(labId);
    const instance = hasLabsAdmin
      ? await this.deps.repo.findInstanceById(input.instanceId)
      : await this.deps.repo.findInstanceForUser(actor.userId, input.instanceId);
    if (!instance) {
      throw new NotFoundError('Lab instance not found.', [{ code: ERROR_CODES.INSTANCE_NOT_FOUND }]);
    }
    if (instance.labId !== labId) {
      throw new ConflictError('The instance belongs to another lab.', [
        { code: ERROR_CODES.INSTANCE_LAB_MISMATCH },
      ]);
    }
    if (instance.status !== 'running') {
      throw new ConflictError('The lab environment is not running.', [
        { code: ERROR_CODES.INSTANCE_NOT_RUNNING },
      ]);
    }

    const check = input.stepId !== undefined ? await this.savedTaskCheck(labId, input.stepId) : input.check;
    if (!check) {
      throw new ValidationError('Provide exactly one of stepId or check.');
    }

    const outcome = await this.deps.checks.evaluate(input.instanceId, check);
    crashAudit(actor, AUDIT_ACTIONS.TEST_LAB_CHECK, 'lab', labId, {
      instanceId: input.instanceId,
      stepId: input.stepId ?? null,
      passed: outcome.passed,
    });
    return {
      result: {
        passed: outcome.passed,
        reason: outcome.reason,
        exitCode: outcome.exitCode,
        statusCode: outcome.statusCode,
        durationMs: outcome.durationMs,
        stdout: truncateOutput(outcome.stdout),
        stderr: truncateOutput(outcome.stderr),
      },
    };
  }

  /* ── Track administration (C1: track content is courses only) ─────────── */

  async listTracksAdmin(): Promise<AdminTrackDto[]> {
    return this.loadAdminTracks();
  }

  async getTrack(trackId: number): Promise<AdminTrackDetailDto> {
    const track = await this.requireTrack(trackId);
    return { ...track, content: await this.loadTrackContent(trackId) };
  }

  /** The single track of the platform: 409 `SINGLE_TRACK_ONLY` when one already exists. */
  async createTrack(actor: AdminActor, input: CreateTrackInput): Promise<AdminTrackDetailDto> {
    const [existing] = await db.select({ trackId: tracks.trackId }).from(tracks).limit(1);
    if (existing) {
      throw new ConflictError('Only one track is supported.', [{ code: ERROR_CODES.SINGLE_TRACK_ONLY }]);
    }
    await this.assertTrackIdentityAvailable(input.slug, input.trackName);

    const trackId = await this.runTrackWrite(async (tx) => {
      const inserted = await tx.insert(tracks).values({
        trackName: input.trackName,
        slug: input.slug,
        description: input.description ?? null,
        difficultyId: input.difficultyId,
        categoryId: input.categoryId ?? null,
        isPremium: input.isPremium ?? false,
        isActive: true,
        totalLabs: 0,
      });
      const newTrackId = inserted[0]?.insertId;
      if (!newTrackId) {
        throw new Error('Failed to create track.');
      }
      return newTrackId;
    });

    crashAudit(actor, AUDIT_ACTIONS.CREATE_TRACK, 'track', trackId, {
      trackName: input.trackName,
      slug: input.slug,
    });
    return this.getTrack(trackId);
  }

  async updateTrack(actor: AdminActor, trackId: number, input: UpdateTrackInput): Promise<AdminTrackDetailDto> {
    await this.requireTrack(trackId);
    if (input.slug !== undefined || input.trackName !== undefined) {
      await this.assertTrackIdentityAvailable(input.slug, input.trackName, trackId);
    }
    const patch = {
      trackName: input.trackName,
      slug: input.slug,
      description: input.description,
      difficultyId: input.difficultyId,
      categoryId: input.categoryId,
      isActive: input.isActive,
      isPremium: input.isPremium,
    };
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(definedPatch).length > 0) {
      await this.runTrackWrite(async (tx) => {
        await tx.update(tracks).set(definedPatch).where(eq(tracks.trackId, trackId));
        return trackId;
      });
    }
    crashAudit(actor, AUDIT_ACTIONS.UPDATE_TRACK, 'track', trackId, definedPatch);
    return this.getTrack(trackId);
  }

  /** Appends a course to the track (409 `TRACK_CONTENT_EXISTS`, 404 `COURSE_NOT_FOUND`). */
  async attachTrackContent(
    actor: AdminActor,
    trackId: number,
    input: { courseId: number; required: boolean },
  ): Promise<AdminTrackDetailDto> {
    await this.requireTrack(trackId);
    const [course] = await db
      .select({ courseId: academyCourses.courseId })
      .from(academyCourses)
      .where(eq(academyCourses.courseId, input.courseId))
      .limit(1);
    if (!course) {
      throw new NotFoundError('Course not found.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
    }

    await this.runTrackWrite(async (tx) => {
      if (await this.findTrackCourse(tx, trackId, input.courseId)) {
        throw new ConflictError('The course is already in this track.', [
          { code: ERROR_CODES.TRACK_CONTENT_EXISTS },
        ]);
      }
      const [last] = await tx
        .select({ value: max(trackContent.displayOrder) })
        .from(trackContent)
        .where(and(eq(trackContent.trackId, trackId), eq(trackContent.contentType, 'course')));
      await tx.insert(trackContent).values({
        trackId,
        contentType: 'course',
        contentId: input.courseId,
        displayOrder: (last?.value ?? 0) + 1,
        required: input.required,
      });
      await this.recomputeTotalLabs(tx, trackId);
      return trackId;
    });

    crashAudit(actor, AUDIT_ACTIONS.ATTACH_TRACK_CONTENT, 'track', trackId, {
      courseId: input.courseId,
      required: input.required,
    });
    return this.getTrack(trackId);
  }

  /** Toggles the `required` flag of an attached course (404 `TRACK_CONTENT_NOT_FOUND`). */
  async updateTrackContent(
    actor: AdminActor,
    trackId: number,
    courseId: number,
    input: { required: boolean },
  ): Promise<AdminTrackDetailDto> {
    await this.requireTrack(trackId);
    await this.runTrackWrite(async (tx) => {
      await this.requireTrackCourse(tx, trackId, courseId);
      await tx
        .update(trackContent)
        .set({ required: input.required })
        .where(
          and(
            eq(trackContent.trackId, trackId),
            eq(trackContent.contentType, 'course'),
            eq(trackContent.contentId, courseId),
          ),
        );
      return trackId;
    });

    crashAudit(actor, AUDIT_ACTIONS.UPDATE_TRACK_CONTENT, 'track', trackId, {
      courseId,
      required: input.required,
    });
    return this.getTrack(trackId);
  }

  /** Detaches a course and compacts `display_order` (404 `TRACK_CONTENT_NOT_FOUND`). */
  async detachTrackContent(actor: AdminActor, trackId: number, courseId: number): Promise<AdminTrackDetailDto> {
    await this.requireTrack(trackId);
    await this.runTrackWrite(async (tx) => {
      await this.requireTrackCourse(tx, trackId, courseId);
      await tx
        .delete(trackContent)
        .where(
          and(
            eq(trackContent.trackId, trackId),
            eq(trackContent.contentType, 'course'),
            eq(trackContent.contentId, courseId),
          ),
        );
      const remaining = await tx
        .select({ contentId: trackContent.contentId })
        .from(trackContent)
        .where(and(eq(trackContent.trackId, trackId), eq(trackContent.contentType, 'course')))
        .orderBy(asc(trackContent.displayOrder));
      for (const [index, row] of remaining.entries()) {
        await tx
          .update(trackContent)
          .set({ displayOrder: index + 1 })
          .where(
            and(
              eq(trackContent.trackId, trackId),
              eq(trackContent.contentType, 'course'),
              eq(trackContent.contentId, row.contentId),
            ),
          );
      }
      await this.recomputeTotalLabs(tx, trackId);
      return trackId;
    });

    crashAudit(actor, AUDIT_ACTIONS.DETACH_TRACK_CONTENT, 'track', trackId, { courseId });
    return this.getTrack(trackId);
  }

  /** Reorders the track courses; the list must be exactly the attached set (422 `REORDER_SET_MISMATCH`). */
  async reorderTrackContent(
    actor: AdminActor,
    trackId: number,
    courseIds: number[],
  ): Promise<AdminTrackDetailDto> {
    await this.requireTrack(trackId);
    await this.runTrackWrite(async (tx) => {
      const current = await tx
        .select({ contentId: trackContent.contentId })
        .from(trackContent)
        .where(and(eq(trackContent.trackId, trackId), eq(trackContent.contentType, 'course')));
      const attached = new Set(current.map((row) => row.contentId));
      const requested = new Set(courseIds);
      const exact =
        requested.size === courseIds.length &&
        courseIds.length === attached.size &&
        courseIds.every((id) => attached.has(id));
      if (!exact) {
        throw new ValidationError('The reorder list must name every course of the track exactly once.', [
          { code: ERROR_CODES.REORDER_SET_MISMATCH },
        ]);
      }
      for (const [index, courseId] of courseIds.entries()) {
        await tx
          .update(trackContent)
          .set({ displayOrder: index + 1 })
          .where(
            and(
              eq(trackContent.trackId, trackId),
              eq(trackContent.contentType, 'course'),
              eq(trackContent.contentId, courseId),
            ),
          );
      }
      return trackId;
    });

    crashAudit(actor, AUDIT_ACTIONS.REORDER_TRACK_CONTENT, 'track', trackId, { courseIds });
    return this.getTrack(trackId);
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

  /* ── Helpers: labs ───────────────────────────────────────────────────── */

  private async requireLab(labId: number): Promise<LabRow> {
    const row = await this.deps.repo.findLabById(labId);
    if (!row) {
      throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
    }
    return row;
  }

  /** Reads the stored step spec of a lab (`pro_labs.flag_values`, missing when there is no row). */
  private async loadStoredSpec(labId: number): Promise<StoredSpecState> {
    const rows = await db
      .select({ storedSpec: sql<unknown>`pro_labs.flag_values` })
      .from(proLabs)
      .where(eq(proLabs.labId, labId))
      .limit(1);
    return readStoredSpec(rows[0]?.storedSpec ?? null);
  }

  /** Slug and title are both unique across labs. */
  private async assertLabIdentityAvailable(slug: string, labName: string, excludeLabId?: number): Promise<void> {
    const [owner] = await db
      .select({ labId: labs.labId })
      .from(labs)
      .where(
        and(
          or(eq(labs.slug, slug), eq(labs.labName, labName)),
          excludeLabId === undefined ? undefined : ne(labs.labId, excludeLabId),
        ),
      )
      .limit(1);
    if (owner) {
      throw new ConflictError('A lab with this slug or title already exists.', [
        { code: ERROR_CODES.SLUG_TAKEN },
      ]);
    }
  }

  /** Runs a lab write in one transaction; a duplicate key becomes 409 `SLUG_TAKEN`. */
  private async runLabWrite<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(work);
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictError('A lab with this slug or title already exists.', [
          { code: ERROR_CODES.SLUG_TAKEN },
        ]);
      }
      throw error;
    }
  }

  /**
   * Upserts the lab's `pro_labs` row. The JSON column is written with a bound
   * parameter; `required_root_count` is always the step count (C§6.2), and a
   * null spec leaves the lab without steps (`missing`).
   */
  private async upsertProLabRow(
    executor: DbOrTx,
    input: { labId: number; networkIpRange: string | null; totalMachines: number; spec: StoredLabSpec | null },
  ): Promise<void> {
    const specJson = input.spec === null ? null : JSON.stringify(input.spec);
    const requiredRootCount = input.spec?.steps.length ?? 0;
    await executor.execute(sql`
      INSERT INTO pro_labs (lab_id, network_ip_range, total_machines, required_root_count, flag_values)
      VALUES (${input.labId}, ${input.networkIpRange}, ${input.totalMachines}, ${requiredRootCount}, CAST(${specJson} AS JSON))
      ON DUPLICATE KEY UPDATE
        flag_values = VALUES(flag_values),
        required_root_count = VALUES(required_root_count)
    `);
  }

  /** Warnings for saved step ids that disappeared while learners had passed them. */
  private async removedStepWarnings(
    labId: number,
    previous: LabSpecV2 | null,
    next: StoredLabSpec,
  ): Promise<string[]> {
    if (!previous) {
      return [];
    }
    const nextIds = new Set(next.steps.map((step) => step.id));
    const removedIds = previous.steps.map((step) => step.id).filter((id) => !nextIds.has(id));
    const warnings: string[] = [];
    for (const stepId of removedIds) {
      const passers = await this.countStepPassers(labId, stepId);
      if (passers > 0) {
        warnings.push(`Step ${stepId} was removed or renamed; ${passers} learners passed it`);
      }
    }
    return warnings;
  }

  /** Distinct learners with a LAB_STEP_PASSED event for one step (activity_logs is the only source). */
  private async countStepPassers(labId: number, stepId: string): Promise<number> {
    const rows = await db
      .select({ total: sql<number>`count(distinct ${activityLogs.userId})` })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.activityType, 'LAB_STEP_PASSED'),
          sql`json_extract(${activityLogs.details}, '$.labId') = ${labId}`,
          sql`json_unquote(json_extract(${activityLogs.details}, '$.stepId')) = ${stepId}`,
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  /** The saved task check of a step (the spec is evaluated, never a client-supplied one). */
  private async savedTaskCheck(labId: number, stepId: string): Promise<LabStepCheck> {
    const stored = await this.loadStoredSpec(labId);
    if (!stored.spec) {
      throw new ConflictError('The lab spec is not ready.', [{ code: ERROR_CODES.LAB_NOT_READY }]);
    }
    const step = stored.spec.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new NotFoundError('Step not found.', [{ code: ERROR_CODES.STEP_NOT_FOUND }]);
    }
    if (!step.check) {
      throw new ValidationError('Question steps have no check to test.');
    }
    return step.check;
  }

  /** Publish gate: the slug must exist in the Labs catalog (a lab without an image can never be provisioned). */
  private async assertCatalogLab(slug: string): Promise<void> {
    if (!ITEM_SLUG_RE.test(slug)) {
      throw new ConflictError('The lab slug is not in the Labs catalog.', [
        { code: ERROR_CODES.CATALOG_LAB_NOT_FOUND },
      ]);
    }
    const manifest = await this.deps.orchestration.getCatalogLab(slug);
    if (!manifest) {
      throw new ConflictError('The lab slug is not in the Labs catalog.', [
        { code: ERROR_CODES.CATALOG_LAB_NOT_FOUND },
      ]);
    }
  }

  private toAdminLabDto(row: LabRow, stored: StoredSpecState, usage: AdminLabUsageDto): AdminLabDto {
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
      specStatus: stored.status,
      stepCount: stored.spec?.steps.length ?? 0,
      usage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /* ── Helpers: tracks ─────────────────────────────────────────────────── */

  private async requireTrack(trackId: number): Promise<AdminTrackDto> {
    const [track] = await this.loadAdminTracks(trackId);
    if (!track) {
      throw new NotFoundError('Track not found.');
    }
    return track;
  }

  /** Track rows with their course counts (`courseCount` counts course content rows). */
  private async loadAdminTracks(trackId?: number): Promise<AdminTrackDto[]> {
    const rows = await db
      .select()
      .from(tracks)
      .where(trackId === undefined ? undefined : eq(tracks.trackId, trackId))
      .orderBy(asc(tracks.trackName));
    const counts = await db
      .select({ trackId: trackContent.trackId, total: sql<number>`count(*)` })
      .from(trackContent)
      .where(
        and(
          eq(trackContent.contentType, 'course'),
          trackId === undefined ? undefined : eq(trackContent.trackId, trackId),
        ),
      )
      .groupBy(trackContent.trackId);
    const countByTrack = new Map(counts.map((row) => [row.trackId, Number(row.total)]));
    return rows.map((row) => ({
      trackId: row.trackId,
      trackName: row.trackName,
      slug: row.slug,
      description: row.description,
      difficultyId: row.difficultyId,
      categoryId: row.categoryId,
      isActive: row.isActive,
      isPremium: row.isPremium,
      totalLabs: row.totalLabs,
      courseCount: countByTrack.get(row.trackId) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Attached courses in display order with their module and item counts. */
  private async loadTrackContent(trackId: number): Promise<AdminTrackContentDto[]> {
    const rows = await db
      .select({
        courseId: academyCourses.courseId,
        title: academyCourses.title,
        isPublished: academyCourses.isPublished,
        displayOrder: trackContent.displayOrder,
        required: trackContent.required,
      })
      .from(trackContent)
      .innerJoin(academyCourses, eq(academyCourses.courseId, trackContent.contentId))
      .where(and(eq(trackContent.trackId, trackId), eq(trackContent.contentType, 'course')))
      .orderBy(asc(trackContent.displayOrder));
    if (rows.length === 0) {
      return [];
    }
    const courseIds = rows.map((row) => row.courseId);
    const moduleRows = await db
      .select({ courseId: modules.courseId, total: sql<number>`count(*)` })
      .from(modules)
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId);
    const itemRows = await db
      .select({ courseId: modules.courseId, total: sql<number>`count(*)` })
      .from(lessons)
      .innerJoin(modules, eq(modules.moduleId, lessons.moduleId))
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId);
    const moduleCounts = new Map(moduleRows.map((row) => [row.courseId, Number(row.total)]));
    const itemCounts = new Map(itemRows.map((row) => [row.courseId, Number(row.total)]));
    return rows.map((row) => ({
      courseId: row.courseId,
      title: row.title,
      isPublished: row.isPublished,
      displayOrder: row.displayOrder,
      required: row.required,
      moduleCount: moduleCounts.get(row.courseId) ?? 0,
      itemCount: itemCounts.get(row.courseId) ?? 0,
    }));
  }

  /** Track name and slug are unique. */
  private async assertTrackIdentityAvailable(slug?: string, trackName?: string, excludeTrackId?: number): Promise<void> {
    const conditions = [
      slug === undefined ? undefined : eq(tracks.slug, slug),
      trackName === undefined ? undefined : eq(tracks.trackName, trackName),
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    if (conditions.length === 0) {
      return;
    }
    const [owner] = await db
      .select({ trackId: tracks.trackId })
      .from(tracks)
      .where(
        and(
          or(...conditions),
          excludeTrackId === undefined ? undefined : ne(tracks.trackId, excludeTrackId),
        ),
      )
      .limit(1);
    if (owner) {
      throw new ConflictError('A track with this slug or name already exists.', [
        { code: ERROR_CODES.SLUG_TAKEN },
      ]);
    }
  }

  /** Runs a track write in one transaction; a duplicate key becomes 409 `SLUG_TAKEN`. */
  private async runTrackWrite<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(work);
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictError('A track with this slug or name already exists.', [
          { code: ERROR_CODES.SLUG_TAKEN },
        ]);
      }
      throw error;
    }
  }

  private async findTrackCourse(executor: DbOrTx, trackId: number, courseId: number): Promise<boolean> {
    const [row] = await executor
      .select({ contentId: trackContent.contentId })
      .from(trackContent)
      .where(
        and(
          eq(trackContent.trackId, trackId),
          eq(trackContent.contentType, 'course'),
          eq(trackContent.contentId, courseId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async requireTrackCourse(executor: DbOrTx, trackId: number, courseId: number): Promise<void> {
    if (!(await this.findTrackCourse(executor, trackId, courseId))) {
      throw new NotFoundError('The course is not in this track.', [
        { code: ERROR_CODES.TRACK_CONTENT_NOT_FOUND },
      ]);
    }
  }

  /**
   * `tracks.total_labs` = distinct active labs used by lab items of the track's
   * courses. Recomputed inside the same transaction as every content change.
   */
  private async recomputeTotalLabs(executor: DbOrTx, trackId: number): Promise<number> {
    const [row] = await executor
      .select({ total: sql<number>`count(distinct ${labs.labId})` })
      .from(trackContent)
      .innerJoin(modules, eq(modules.courseId, trackContent.contentId))
      .innerJoin(lessons, eq(lessons.moduleId, modules.moduleId))
      .innerJoin(labs, eq(labs.labId, lessons.labId))
      .where(
        and(
          eq(trackContent.trackId, trackId),
          eq(trackContent.contentType, 'course'),
          eq(lessons.contentType, 'lab'),
          eq(labs.isActive, true),
        ),
      );
    const totalLabs = Number(row?.total ?? 0);
    await executor.update(tracks).set({ totalLabs }).where(eq(tracks.trackId, trackId));
    return totalLabs;
  }
}

export const adminLabService = new AdminLabService();
