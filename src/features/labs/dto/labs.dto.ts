import type { LabMode, LabSpecIssue, LabSpecV2, LabStepKind } from './lab-spec.dto';

/**
 * F6 response DTOs. All dates are ISO strings. Mirrors the contract §05
 * domain interfaces and the §07 endpoint response shapes. Learner DTOs are
 * allowlists built field by field: step checks, setup scripts, accepted
 * answers and unrevealed hints never appear in them (contracts §0.2).
 */

export type LabType = 'pro_lab' | 'sherlock' | 'vip_lab';
export type VpnRegion = 'US' | 'EU' | 'ASIA' | 'AUSTRALIA' | 'SOUTH_AMERICA' | 'AFRICA';
export type LabInstanceStatus = 'pending' | 'running' | 'stopped' | 'terminated' | 'error';
export type TrackContentType = 'lab' | 'course';

export interface LabDto {
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
  isStarted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Sherlock detail: question text and hints only. Answers NEVER leave the server. */
export interface SherlockDetailDto {
  sherlockId: number;
  labId: number;
  evidenceFileUrl: string | null;
  evidenceFileSize: number | null;
  fileHash: string | null;
  questions: Array<{ id: string; text: string; hint: string | null }>;
  requiredCorrectAnswers: number;
}

/** One step of a lab as shown before starting it (no instructions, hints or checks). */
export interface LabStepSummaryDto {
  stepId: string;
  position: number;
  title: string;
  kind: LabStepKind;
  points: number;
}

/**
 * LAB-02 public lab detail. Built field by field from the v2 spec: checks,
 * setup scripts, accepted answers and hints never appear here (D21).
 */
export interface LabDetailDto extends LabDto {
  /** False when anonymous. */
  isCompleted: boolean;
  /** Null when the lab has no runnable v2 spec. */
  mode: LabMode | null;
  /** Markdown, stored verbatim (the frontend sanitizes). */
  scenarioIntro: string;
  stepCount: number;
  /** Sum of step points plus the completion bonus. */
  pointsAvailable: number;
  steps: LabStepSummaryDto[];
  sherlock: SherlockDetailDto | null;
}

/* ── Lab steps (contracts §4.1) ─────────────────────────────────────────── */

export type LabStepStatus = 'locked' | 'current' | 'passed';

export interface LearnerLabStepDto {
  stepId: string;
  position: number;
  title: string;
  kind: LabStepKind;
  status: LabStepStatus;
  /** Markdown; null while the step is locked. */
  instructions: string | null;
  points: number;
  pointsAwarded: number;
  passedAt: string | null;
  /** `setup.length > 0 || kind === 'question'`. */
  requiresStage: boolean;
  /** Set when the step was staged on the learner's active instance of this lab. */
  stagedOnInstanceId: number | null;
  /** Per-step hint cost (`step.hintCost`, not scaled by the difficulty multiplier). */
  hints: {
    total: number;
    revealed: Array<{ hintIndex: number; text: string }>;
    nextHintIndex: number | null;
    cost: number;
  };
  /** Per-step penalties (`step.wrongPenalty` / `step.guessPenalty`); both 0 for task steps. */
  penalties: { wrongAnswer: number; guess: number };
}

export interface LabStepsStateDto {
  labId: number;
  slug: string;
  labName: string;
  mode: LabMode;
  scenarioIntro: string;
  steps: LearnerLabStepDto[];
  currentStepId: string | null;
  completedAt: string | null;
  /** Scaled completion bonus (`spec.completionBonus` times the difficulty multiplier). */
  completionBonus: number;
  totals: {
    pointsAvailable: number;
    pointsEarned: number;
    hintPenalties: number;
    wrongAnswerPenalties: number;
    guessPenalties: number;
  };
  /** Non-null only when the learner's active instance belongs to this lab. */
  activeInstance: {
    instanceId: number;
    status: LabInstanceStatus;
    expiresAt: string | null;
    terminalWsUrl: string | null;
  } | null;
  /** The learner's active instance of ANOTHER lab (the frontend offers to end it). */
  otherActiveInstance: { instanceId: number; labId: number; labName: string } | null;
}

/** XP change produced by a mutation plus the resulting balance. */
export interface XpDeltaDto {
  delta: number;
  balance: number;
}

export type LabStepCheckReason = 'passed' | 'not_passed' | 'timeout' | 'wrong_answer';

export interface LabStepCheckResultDto {
  stepId: string;
  passed: boolean;
  alreadyPassed: boolean;
  reason: LabStepCheckReason;
  /** Generic message; never stdout/stderr or hint text. */
  message: string;
  /** Question steps only: no shell command was run since the step was staged. */
  guessed: boolean;
  pointsAwarded: number;
  penalties: { wrongAnswer: number; guess: number };
  nextStepId: string | null;
  labCompleted: boolean;
  completion: null | { completedAt: string; completionBonus: number; completedLessonIds: number[] };
  xp: XpDeltaDto;
}

export interface LabStepStageResultDto {
  stepId: string;
  instanceId: number;
  stagedAt: string;
  setupRan: boolean;
}

export interface HintRevealResultDto {
  stepId: string;
  hintIndex: number;
  text: string;
  alreadyRevealed: boolean;
  penaltyApplied: number;
  remaining: number;
  xp: XpDeltaDto;
}

/** Active instance summary consumed by admin dashboards (§02). */
export interface ActiveLabInstance {
  instanceId: number;
  userId: number;
  labId: number;
  labName: string;
  status: LabInstanceStatus;
  startedAt: string;
  expiresAt: string | null;
  assignedIp: string | null;
  username: string | null;
}

/**
 * LAB-03 201 payload. No credential is generated or returned: the container
 * never used the old root password (D27).
 */
export interface ProvisionInstanceDto {
  instanceId: number;
  labId: number;
  labSlug: string;
  status: 'pending' | 'running';
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  terminalWsUrl: string;
  expiresAt: string;
  vpnAssignment: {
    ovpnConfigUrl: string | null;
  };
}

/** LAB-04 active instance payload: no credential fields. */
export interface ActiveInstanceDto {
  instanceId: number;
  labId: number;
  labName: string;
  slug: string;
  status: LabInstanceStatus;
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  ramGb: number;
  cpuCores: number;
  diskGb: number;
  startedAt: string;
  expiresAt: string | null;
  terminalWsUrl: string | null;
}

export interface StopInstanceDto {
  instanceId: number;
  status: 'stopped';
}

export interface TerminateInstanceDto {
  instanceId: number;
  status: 'terminated';
}

export interface ExtendInstanceDto {
  instanceId: number;
  newExpiresAt: string;
  extensionsUsed: number;
  extensionsRemaining: number;
}

export interface SherlockSubmissionResultDto {
  labId: number;
  results: Array<{ questionId: string; passed: boolean }>;
  isPassed: boolean;
  score: number;
}

/** LAB-11 request/SSE payloads. */
export interface AiMentorMessageDto {
  sessionKey: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

export interface AiMentorSessionDto {
  sessionKey: string;
  contextLessonId: number | null;
  contextLabId: number | null;
  createdAt: string;
  ttlSeconds: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

export interface VpnConfigDto {
  assignmentId: number;
  vpnId: number;
  serverName: string;
  serverLocation: string | null;
  region: VpnRegion;
  ovpnConfigUrl: string | null;
  assignedAt: string;
  expiresAt: string | null;
}

export interface TrackDto {
  trackId: number;
  trackName: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  difficultyName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  totalLabs: number;
  isActive: boolean;
  isPremium: boolean;
  createdAt: string;
}

export interface TrackContentItemDto {
  trackId: number;
  contentType: TrackContentType;
  contentId: number;
  displayOrder: number;
  required: boolean;
  title: string;
  completed: boolean;
}

export interface TrackDetailDto extends TrackDto {
  totalCourses: number;
  items: TrackContentItemDto[];
}

export interface TrackProgressItemDto {
  trackId: number;
  contentType: TrackContentType;
  contentId: number;
  displayOrder: number;
  required: boolean;
  title: string;
  completed: boolean;
  /** Per-course progress (completed published items / published items). */
  progressPercentage: number;
}

export interface TrackProgressDto {
  trackId: number;
  trackName: string;
  slug: string;
  totalItems: number;
  completedItems: number;
  totalRequired: number | null;
  completedRequired: number;
  progressPercentage: number;
  isCompleted: boolean;
  items: TrackProgressItemDto[];
}

/** Readiness of a lab's stored step spec (`parseLabSpec` outcome). */
export type LabSpecStatus = 'v2' | 'legacy' | 'missing' | 'invalid';

/** Where a lab is used and whether learners have touched it. */
export interface AdminLabUsageDto {
  /** `lessons.lesson_id` of every module item pointing at this lab. */
  itemIds: number[];
  activeInstances: number;
  /** Learners with a LAB_COMPLETED event for this lab. */
  completions: number;
  /** Learners with any LAB_* event for this lab. */
  learnersWithProgress: number;
}

/** Admin labs library row (contracts §6.2). */
export interface AdminLabDto {
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
  specStatus: LabSpecStatus;
  stepCount: number;
  usage: AdminLabUsageDto;
  createdAt: string;
  updatedAt: string;
}

/** Admin lab detail: the FULL spec including server-only fields (admin only). */
export interface AdminLabDetailDto extends AdminLabDto {
  spec: LabSpecV2 | null;
  specIssues: LabSpecIssue[];
}

/** Learner walkthrough (`lab-guide.md` from the Labs catalog), markdown stored verbatim. */
export interface LabWalkthroughDto {
  labId: number;
  slug: string;
  markdown: string;
}

/** Labs catalog entry (CxxMxxLxx) for the admin import picker. Never carries commands, hints or answers. */
export interface CatalogLabDto {
  slug: string;
  courseSlug: string;
  moduleSlug: string;
  moduleTitle: string;
  manifestLabId: number;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  estimatedHours: number;
  dockerImage: string;
  stepCount: number;
  steps: Array<{ id: string; title: string; kind: LabStepKind }>;
  /** `labs.lab_id` with the same slug, when already imported. */
  importedLabId: number | null;
  isUsed: boolean;
}

/** Admin test-check output. `stdout`/`stderr` are truncated and never persisted. */
export interface AdminCheckResultDto {
  passed: boolean;
  reason: 'passed' | 'not_passed' | 'timeout';
  exitCode: number | null;
  statusCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/** Admin track row (contracts §6.2). `totalLabs` is computed server side. */
export interface AdminTrackDto {
  trackId: number;
  trackName: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  categoryId: number | null;
  isActive: boolean;
  isPremium: boolean;
  totalLabs: number;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTrackContentDto {
  courseId: number;
  title: string;
  isPublished: boolean;
  displayOrder: number;
  required: boolean;
  moduleCount: number;
  itemCount: number;
}

export interface AdminTrackDetailDto extends AdminTrackDto {
  content: AdminTrackContentDto[];
}

/**
 * Pro-lab infrastructure config. Steps live in the v2 spec (`PUT /admin/labs/:labId/spec`),
 * which also rewrites `requiredRootCount = steps.length` and `totalMachines = 1` on save.
 */
export interface ProLabConfigDto {
  networkIpRange: string | null;
  totalMachines: number;
  requiredRootCount: number;
}

/** Sherlock config payload. `answers` are write-only (never serialized). */
export interface SherlockConfigDto {
  evidenceFileUrl: string | null;
  evidenceFileSize: number | null;
  fileHash: string | null;
  questions: Array<{ id: string; text: string; hint?: string }>;
  answers: Array<{ id: string; answer: string }>;
  requiredCorrectAnswers: number;
}

export interface CreateLabInput {
  labName: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  categoryId: number | null;
  labType: LabType;
  isPremium: boolean;
  estimatedHours: number;
  networkDiagramUrl: string | null;
  proLabConfig: ProLabConfigDto | null;
  sherlockConfig: SherlockConfigDto | null;
  /** Optional initial step spec (validated with `labSpecV2Schema`). */
  spec?: LabSpecV2;
}

export interface UpdateLabInput {
  labName?: string;
  slug?: string;
  description?: string | null;
  difficultyId?: number;
  categoryId?: number | null;
  isPremium?: boolean;
  estimatedHours?: number;
  networkDiagramUrl?: string | null;
  proLabConfig?: ProLabConfigDto | null;
  sherlockConfig?: SherlockConfigDto | null;
}

export interface TrackContentInput {
  contentType: TrackContentType;
  contentId: number;
  displayOrder: number;
  required: boolean;
}

export interface CreateTrackInput {
  trackName: string;
  slug: string;
  description?: string | null;
  difficultyId: number;
  categoryId?: number | null;
  isPremium?: boolean;
}

export interface UpdateTrackInput {
  trackName?: string;
  slug?: string;
  description?: string | null;
  difficultyId?: number;
  categoryId?: number | null;
  isActive?: boolean;
  isPremium?: boolean;
}

/** AI Mentor session shape (Redis-only; never written to SQL). */
export interface AiMentorSession {
  sessionKey: string;
  userId: number;
  contextLessonId: number | null;
  contextLabId: number | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: string;
  ttlSeconds: number;
}

/** Lab completion event shape consumed by F5 progress injection (§02). */
export interface LabCompletionEvent {
  labId: number;
  instanceId: number | null;
  labType: LabType | null;
  passedAt: string;
  timeTakenSeconds: number | null;
}