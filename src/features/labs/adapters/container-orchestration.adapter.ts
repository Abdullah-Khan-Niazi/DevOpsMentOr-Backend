import { z } from 'zod';
import { env } from '../../../app/config';
import { AppError, ERROR_CODES, NotFoundError, type ErrorCode } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { labStepSchema } from '../validators/lab-spec.validator';

/**
 * Adapter for the Labs orchestrator (contracts §6.3, §7.0).
 *
 * Every call: base URL only from `CONTAINER_ORCHESTRATION_API_URL`, `redirect:
 * 'error'`, bearer `CONTAINER_ORCHESTRATION_API_KEY`, `AbortSignal.timeout`,
 * responses validated with zod. Instance calls map failures to 503
 * `LAB_ENV_UNREACHABLE`; catalog calls map them to 503 `CATALOG_UNAVAILABLE`.
 * Command text, command output and credentials are never logged; logs carry
 * only `{ code, status, instanceId | slug }`.
 */

export interface ContainerInstanceInput {
  labId: number;
  labSlug: string;
  instanceId: number;
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

export interface ContainerInstanceLookup {
  terminalWsUrl: string;
  hostPort: number;
  status: string | null;
}

export interface ContainerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ContainerHttpProbeResult {
  statusCode: number;
}

/* ── Response schemas ───────────────────────────────────────────────────── */

const instanceLookupSchema = z.object({
  terminalWsUrl: z.string().url(),
  hostPort: z.number().int().min(0).max(65535),
  status: z.string().nullable().optional().transform((value) => value ?? null),
});

const createInstanceSchema = z.object({
  hostname: z.string(),
  assignedIp: z.string(),
  sshPort: z.number().int().min(0).max(65535),
  terminalWsUrl: z.string().url(),
});

/**
 * Exec response. `exitCode` is required and never defaults to 0: a response
 * without it is a failed call. The optional fields keep this compatible with
 * the Labs exec before and after the orchestrator changes (contracts §6.3).
 */
const execResponseSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string().default(''),
  timedOut: z.boolean().default(false),
  durationMs: z.number().default(0),
  truncated: z.object({ stdout: z.boolean(), stderr: z.boolean() }).partial().default({}),
});

const httpProbeSchema = z.object({
  statusCode: z.number().int().min(0).max(999),
});

const CATALOG_SLUG_PATTERN = /^C\d{2}M\d{2}L\d{2}$/;
const MODULE_SLUG_PATTERN = /^C\d{2}M\d{2}$/;
const COURSE_SLUG_PATTERN = /^C\d{2}$/;

const catalogStepSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['task', 'question']),
});

/** One entry of `GET /catalog/labs` (no commands, hints or answers). */
export const labsCatalogSummarySchema = z.object({
  slug: z.string().regex(CATALOG_SLUG_PATTERN),
  labId: z.number().int().positive(),
  courseSlug: z.string().regex(COURSE_SLUG_PATTERN),
  moduleSlug: z.string().regex(MODULE_SLUG_PATTERN),
  moduleTitle: z.string(),
  title: z.string(),
  description: z.string(),
  difficulty: z.string(),
  category: z.string(),
  estimatedHours: z.number(),
  dockerImage: z.string(),
  stepCount: z.number().int().min(0),
  steps: z.array(catalogStepSummarySchema),
});

/** Full lab manifest (`GET /catalog/labs/:slug`). Steps are exactly `LabStepV2`. */
export const labsManifestSchema = z.object({
  slug: z.string().regex(CATALOG_SLUG_PATTERN),
  labId: z.number().int().positive(),
  courseSlug: z.string().regex(COURSE_SLUG_PATTERN),
  moduleSlug: z.string().regex(MODULE_SLUG_PATTERN),
  moduleTitle: z.string(),
  title: z.string(),
  description: z.string(),
  estimatedHours: z.number(),
  difficulty: z.string(),
  category: z.string(),
  dockerImage: z.string(),
  mode: z.enum(['guided', 'break_fix']),
  scenario: z.object({
    intro: z.string(),
    setup: z.array(z.string()),
  }),
  completionBonus: z.number().int().min(0),
  steps: z.array(labStepSchema).min(1),
});

const trackMilestoneSchema = z.object({
  name: z.string(),
  description: z.string(),
  triggerType: z.string(),
  count: z.number().int().min(0),
  points: z.number().int().min(0),
});

/** `src/definitions/catalog/track.json`. */
const labsTrackSchema = z.object({
  slug: z.string(),
  trackName: z.string(),
  description: z.string(),
  milestones: z.array(trackMilestoneSchema),
});

/** `src/definitions/catalog/<NN>-<course>/course.json`. */
const labsCourseSchema = z.object({
  slug: z.string().regex(COURSE_SLUG_PATTERN),
  order: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  slidesKey: z.string().nullable(),
  rewards: z.object({
    moduleCompletePoints: z.number().int().min(0),
    courseCompletePoints: z.number().int().min(0),
    badge: z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string(),
    }),
  }),
});

/** `GET /catalog/export`: the track plus every course with its modules and full manifests. */
export const labsCatalogExportSchema = z.object({
  track: labsTrackSchema,
  courses: z.array(
    labsCourseSchema.extend({
      modules: z.array(
        z.object({
          slug: z.string().regex(MODULE_SLUG_PATTERN),
          order: z.number().int().positive(),
          moduleTitle: z.string(),
          lab: labsManifestSchema,
        }),
      ),
    }),
  ),
});

export type LabsCatalogSummary = z.output<typeof labsCatalogSummarySchema>;
export type LabsManifest = z.output<typeof labsManifestSchema>;
export type LabsCatalogExport = z.output<typeof labsCatalogExportSchema>;

/** Every Labs catalog response is wrapped as `{ success: true, data }`. */
const catalogEnvelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

/* ── Timeouts and limits ────────────────────────────────────────────────── */

const HEALTH_TIMEOUT_MS = 3_000;
const INSTANCE_LOOKUP_TIMEOUT_MS = 5_000;
const INSTANCE_CONTROL_TIMEOUT_MS = 15_000;
const INSTANCE_CREATE_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const TIMEOUT_GRACE_MS = 5_000;
const CATALOG_TIMEOUT_MS = 10_000;
const CATALOG_EXPORT_TIMEOUT_MS = 30_000;
const MAX_GUIDE_CHARACTERS = 1_000_000;
/** Exit code reported for a command that exceeded its timeout (never a pass). */
const TIMED_OUT_EXIT_CODE = 124;

type FailureCode = Extract<ErrorCode, 'LAB_ENV_UNREACHABLE' | 'CATALOG_UNAVAILABLE'>;
type LogContext = Record<string, string | number>;

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs: number;
  failure: FailureCode;
  log: LogContext;
  /** Return abort errors to the caller instead of mapping them to a 503 (exec timeouts). */
  rethrowAbort?: boolean;
}

function unavailable(code: FailureCode): AppError {
  if (code === ERROR_CODES.CATALOG_UNAVAILABLE) {
    return new AppError('The lab catalog is unavailable. Please try again.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
      { code },
    ]);
  }
  return new AppError('The lab environment is unreachable. Please try again.', HTTP_STATUS.SERVICE_UNAVAILABLE, [
    { code },
  ]);
}

function catalogLabNotFound(): NotFoundError {
  return new NotFoundError('Lab not found in the catalog.', [{ code: ERROR_CODES.CATALOG_LAB_NOT_FOUND }]);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** Only `CxxMxxLxx` slugs ever reach a catalog path; anything else is a 404 with no request. */
function assertCatalogSlug(slug: string): string {
  if (!CATALOG_SLUG_PATTERN.test(slug)) {
    throw catalogLabNotFound();
  }
  return slug;
}

/** Instance ids are interpolated into paths, so only positive safe integers pass. */
function instancePath(instanceId: number, suffix = ''): string {
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0) {
    throw new Error('Invalid lab instance id.');
  }
  return `/instances/${instanceId}${suffix}`;
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
  /**
   * Bearer key for the orchestration API. Present only when
   * `CONTAINER_ORCHESTRATION_API_KEY` is configured; the value is never logged.
   */
  private authHeaders(): Record<string, string> {
    return env.CONTAINER_ORCHESTRATION_API_KEY
      ? { Authorization: `Bearer ${env.CONTAINER_ORCHESTRATION_API_KEY}` }
      : {};
  }

  /** Lightweight reachability check against the Labs orchestrator `/health` endpoint. */
  async checkHealth(): Promise<{ available: boolean; reason?: string }> {
    if (!env.CONTAINER_ORCHESTRATION_API_URL) {
      return { available: false, reason: 'Lab orchestration service is not configured.' };
    }
    const endpoint = env.CONTAINER_ORCHESTRATION_API_URL.replace(/\/$/, '');
    try {
      const response = await fetch(`${endpoint}/health`, {
        method: 'GET',
        headers: this.authHeaders(),
        redirect: 'error',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          available: false,
          reason: `Lab runtime responded with HTTP ${response.status}.`,
        };
      }
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: isAbortError(error)
          ? 'Lab runtime health check timed out.'
          : 'Lab runtime service is offline or unreachable.',
      };
    }
  }

  /** Throws 503 LAB_ENV_UNREACHABLE unless the Labs runtime is up and responding. */
  async assertReachable(): Promise<void> {
    const health = await this.checkHealth();
    if (!health.available) {
      throw new AppError(
        'Lab runtime service is currently offline. Please try again later.',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        [{ code: ERROR_CODES.LAB_ENV_UNREACHABLE }],
      );
    }
  }

  /** Instance lookup. Null only on 404; every other failure throws 503. */
  async getInstance(instanceId: number): Promise<ContainerInstanceLookup | null> {
    const log = { instanceId };
    const response = await this.fetchResponse(instancePath(instanceId), {
      method: 'GET',
      timeoutMs: INSTANCE_LOOKUP_TIMEOUT_MS,
      failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
      log,
    });
    if (response.status === 404) {
      return null;
    }
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
    return this.parseJson(response, instanceLookupSchema, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
  }

  async createInstance(input: ContainerInstanceInput): Promise<ContainerInstanceEndpoint> {
    // Explicit fields only: the container never receives or stores a root credential.
    const log = { instanceId: input.instanceId };
    const response = await this.fetchResponse('/instances', {
      method: 'POST',
      body: {
        labId: input.labId,
        labSlug: input.labSlug,
        instanceId: input.instanceId,
        ramGb: input.ramGb,
        cpuCores: input.cpuCores,
        diskGb: input.diskGb,
      },
      timeoutMs: INSTANCE_CREATE_TIMEOUT_MS,
      failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
      log,
    });
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
    return this.parseJson(response, createInstanceSchema, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
  }

  async stopInstance(instanceId: number): Promise<void> {
    const log = { instanceId };
    const response = await this.fetchResponse(instancePath(instanceId, '/stop'), {
      method: 'POST',
      timeoutMs: INSTANCE_CONTROL_TIMEOUT_MS,
      failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
      log,
    });
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
  }

  /** Idempotent: a 404 (already gone) counts as terminated. */
  async terminateInstance(instanceId: number): Promise<void> {
    const log = { instanceId };
    const response = await this.fetchResponse(instancePath(instanceId), {
      method: 'DELETE',
      timeoutMs: INSTANCE_CONTROL_TIMEOUT_MS,
      failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
      log,
    });
    if (response.status === 404) {
      return;
    }
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
  }

  /**
   * Runs one shell command in the learner's environment. A command that
   * exceeds `timeoutMs` (plus a grace period) resolves to `{ timedOut: true,
   * exitCode: 124 }`, which callers must treat as a failed check.
   */
  async executeCommand(
    instanceId: number,
    command: string,
    opts?: { timeoutMs?: number },
  ): Promise<ContainerCommandResult> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const log = { instanceId };
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchResponse(instancePath(instanceId, '/exec'), {
        method: 'POST',
        body: { command, timeoutMs },
        timeoutMs: timeoutMs + TIMEOUT_GRACE_MS,
        failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
        log,
        rethrowAbort: true,
      });
    } catch (error) {
      if (isAbortError(error)) {
        logger.warn({ instanceId }, 'Lab command exceeded its timeout');
        return {
          exitCode: TIMED_OUT_EXIT_CODE,
          stdout: '',
          stderr: '',
          timedOut: true,
          durationMs: Date.now() - startedAt,
        };
      }
      throw error;
    }
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
    const body = await this.parseJson(response, execResponseSchema, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
    return {
      exitCode: body.exitCode,
      stdout: body.stdout,
      stderr: body.stderr,
      timedOut: body.timedOut,
      durationMs: body.durationMs,
    };
  }

  /** Server-side HTTP probe against the lab environment; `statusCode` is the only output used. */
  async probeHttp(
    instanceId: number,
    opts: { path: string; port: number; timeoutMs: number },
  ): Promise<ContainerHttpProbeResult> {
    const log = { instanceId };
    const response = await this.fetchResponse(instancePath(instanceId, '/http'), {
      method: 'POST',
      body: { path: opts.path, port: opts.port, timeoutMs: opts.timeoutMs },
      timeoutMs: opts.timeoutMs + TIMEOUT_GRACE_MS,
      failure: ERROR_CODES.LAB_ENV_UNREACHABLE,
      log,
    });
    this.ensureOk(response, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
    return this.parseJson(response, httpProbeSchema, ERROR_CODES.LAB_ENV_UNREACHABLE, log);
  }

  /** All catalog labs, summaries only (no commands, hints or answers). */
  async listCatalog(): Promise<LabsCatalogSummary[]> {
    const response = await this.fetchResponse('/catalog/labs', {
      method: 'GET',
      timeoutMs: CATALOG_TIMEOUT_MS,
      failure: ERROR_CODES.CATALOG_UNAVAILABLE,
      log: {},
    });
    this.ensureOk(response, ERROR_CODES.CATALOG_UNAVAILABLE, {});
    const body = await this.parseJson(
      response,
      catalogEnvelope(z.array(labsCatalogSummarySchema)),
      ERROR_CODES.CATALOG_UNAVAILABLE,
      {},
    );
    return body.data;
  }

  /** Full manifest for one lab (secrets included: importer use only). Null on 404. */
  async getCatalogLab(slug: string): Promise<LabsManifest | null> {
    const safeSlug = assertCatalogSlug(slug);
    const log = { slug: safeSlug };
    const response = await this.fetchResponse(`/catalog/labs/${encodeURIComponent(safeSlug)}`, {
      method: 'GET',
      timeoutMs: CATALOG_TIMEOUT_MS,
      failure: ERROR_CODES.CATALOG_UNAVAILABLE,
      log,
    });
    if (response.status === 404) {
      return null;
    }
    this.ensureOk(response, ERROR_CODES.CATALOG_UNAVAILABLE, log);
    const body = await this.parseJson(
      response,
      catalogEnvelope(labsManifestSchema),
      ERROR_CODES.CATALOG_UNAVAILABLE,
      log,
    );
    return body.data;
  }

  /** Walkthrough markdown (`lab-guide.md`), returned verbatim for the frontend to sanitize. Null on 404. */
  async getCatalogGuide(slug: string): Promise<string | null> {
    const safeSlug = assertCatalogSlug(slug);
    const log = { slug: safeSlug };
    const response = await this.fetchResponse(`/catalog/labs/${encodeURIComponent(safeSlug)}/guide`, {
      method: 'GET',
      timeoutMs: CATALOG_TIMEOUT_MS,
      failure: ERROR_CODES.CATALOG_UNAVAILABLE,
      log,
    });
    if (response.status === 404) {
      return null;
    }
    this.ensureOk(response, ERROR_CODES.CATALOG_UNAVAILABLE, log);
    const markdown = await this.readText(response, ERROR_CODES.CATALOG_UNAVAILABLE, log);
    return markdown;
  }

  /** Whole catalog (track, courses, modules and full manifests) for the importer. */
  async getCatalogExport(): Promise<LabsCatalogExport> {
    const response = await this.fetchResponse('/catalog/export', {
      method: 'GET',
      timeoutMs: CATALOG_EXPORT_TIMEOUT_MS,
      failure: ERROR_CODES.CATALOG_UNAVAILABLE,
      log: {},
    });
    this.ensureOk(response, ERROR_CODES.CATALOG_UNAVAILABLE, {});
    const body = await this.parseJson(
      response,
      catalogEnvelope(labsCatalogExportSchema),
      ERROR_CODES.CATALOG_UNAVAILABLE,
      {},
    );
    return body.data;
  }

  /**
   * Single outbound call. Network errors, redirects and aborts map to the
   * request's failure code (abort rethrown when `rethrowAbort`). Status is
   * left to the caller so lookups can treat 404 as "not found".
   */
  private async fetchResponse(path: string, options: RequestOptions): Promise<Response> {
    const endpoint = this.endpointOrThrow();
    try {
      return await fetch(`${endpoint}${path}`, {
        method: options.method,
        headers: {
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...this.authHeaders(),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      if (options.rethrowAbort && isAbortError(error)) {
        throw error;
      }
      logger.error(
        { code: options.failure, reason: isAbortError(error) ? 'timeout' : 'network', ...options.log },
        'Lab orchestration request failed',
      );
      throw unavailable(options.failure);
    }
  }

  private ensureOk(response: Response, failure: FailureCode, log: LogContext): void {
    if (!response.ok) {
      logger.error({ code: failure, status: response.status, ...log }, 'Lab orchestration request rejected');
      throw unavailable(failure);
    }
  }

  private async parseJson<S extends z.ZodTypeAny>(
    response: Response,
    schema: S,
    failure: FailureCode,
    log: LogContext,
  ): Promise<z.output<S>> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      logger.error({ code: failure, status: response.status, ...log }, 'Lab orchestration returned invalid JSON');
      throw unavailable(failure);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logger.error(
        {
          code: failure,
          status: response.status,
          ...log,
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        },
        'Lab orchestration response failed validation',
      );
      throw unavailable(failure);
    }
    return parsed.data as z.output<S>;
  }

  private async readText(response: Response, failure: FailureCode, log: LogContext): Promise<string> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      logger.error({ code: failure, status: response.status, ...log }, 'Lab orchestration body could not be read');
      throw unavailable(failure);
    }
    if (text.length > MAX_GUIDE_CHARACTERS) {
      logger.error({ code: failure, status: response.status, ...log }, 'Lab orchestration body exceeds the limit');
      throw unavailable(failure);
    }
    return text;
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
