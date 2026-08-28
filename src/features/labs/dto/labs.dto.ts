/**
 * F6 response DTOs. All dates are ISO strings. Mirrors the contract §05
 * domain interfaces and the §07 endpoint response shapes.
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

/** Pro-lab detail: `checkpoints` exposes assertion group ids (never scripts). */
export interface ProLabDetailDto {
  proLabId: number;
  labId: number;
  networkIpRange: string | null;
  totalMachines: number;
  requiredRootCount: number;
  checkpoints: Array<{ checkpointId: string; assertionGroupId: string }>;
  activeUsersCount: number;
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

export interface LabDetailDto extends LabDto {
  proLab: ProLabDetailDto | null;
  sherlock: SherlockDetailDto | null;
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

/** LAB-03 201 payload: `rootPassword` appears ONLY here (invariant 2). */
export interface ProvisionInstanceDto {
  instanceId: number;
  labId: number;
  status: 'pending' | 'running';
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  rootPassword: string;
  terminalWsUrl: string;
  expiresAt: string;
  vpnAssignment: {
    ovpnConfigUrl: string | null;
  };
}

/** LAB-04 active instance payload: rootPassword structurally absent. */
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

export interface AssertionResultDto {
  instanceId: number;
  assertions: Array<{
    name: string;
    passed: boolean;
    message: string | null;
  }>;
  allPassed: boolean;
  completedAt: string | null;
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
  contextLessonId: number;
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
  difficultyId: number | null;
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

/** LAB-11/LAB-16 admin payload: flat catalog row (config detail via GET). */
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
  createdAt: string;
  updatedAt: string;
}

/** LAB-18/LAB-19 admin payload: flat catalog row. */
export interface AdminTrackDto {
  trackId: number;
  trackName: string;
  slug: string;
  description: string | null;
  difficultyId: number | null;
  difficultyName: string | null;
  estimatedHours: number;
  isActive: boolean;
  createdAt: string;
}

/** Pro-lab config payload (LAB-16/LAB-17). `flagValues` keys are checkpoint ids. */
export interface ProLabConfigDto {
  networkIpRange: string | null;
  totalMachines: number;
  requiredRootCount: number;
  flagValues: Record<string, string> | null;
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
  description: string | null;
  difficultyId: number | null;
  categoryId: number | null;
  totalLabs: number;
  isPremium: boolean;
  content: TrackContentInput[];
}

export interface UpdateTrackInput {
  trackName?: string;
  slug?: string;
  description?: string | null;
  difficultyId?: number | null;
  categoryId?: number | null;
  totalLabs?: number;
  isActive?: boolean;
  isPremium?: boolean;
  content?: TrackContentInput[];
}

/** AI Mentor session shape (Redis-only; never written to SQL — §02). */
export interface AiMentorSession {
  sessionKey: string;
  userId: number;
  contextLessonId: number;
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