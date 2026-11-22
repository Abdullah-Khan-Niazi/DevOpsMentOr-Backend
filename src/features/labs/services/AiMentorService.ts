import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '../../../app/config';
import { db } from '../../../app/database';
import { academyCourses, labs, lessons, modules, quizzes } from '../../../app/database/schema';
import { redisClient } from '../../../app/cache/redis';
import { AppError, ERROR_CODES, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { activityLogService } from '../../progress/services/ActivityLogService';
import { courseAccessService, type CourseAccessService } from '../../orgs/services/course-access.service';
import type { AiMentorSessionDto } from '../dto/labs.dto';
import type { LabSpecV2, LabStepV2 } from '../dto/lab-spec.dto';
import type { LlmApiAdapter } from '../adapters/llm-api.adapter';
import { llmApiAdapter } from '../adapters/llm-api.adapter';
import type { EntitlementService } from './EntitlementService';
import { entitlementService } from './EntitlementService';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';
import { parseLabSpec } from '../validators/lab-spec.validator';

/** Internal: newest-history window kept per session to bound prompt size. */
const HISTORY_WINDOW = 20;
/** Internal: character budget for each piece of course or lab text sent to the LLM. */
const CONTEXT_CHARS = 4000;

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StoredSession {
  sessionKey: string;
  userId: number;
  contextLessonId: number | null;
  contextLabId: number | null;
  createdAt: string;
  ttlSeconds: number;
  messages: StoredMessage[];
}

/** Published lesson item with the module and course it belongs to (server-side lookup). */
export interface MentorLessonRow {
  lessonId: number;
  title: string;
  content: string | null;
  labId: number | null;
  isPublished: boolean;
  modulePublished: boolean;
  coursePublished: boolean;
  /** Lab items need an active lab, quiz items a published quiz (same visibility rule as the module item list). */
  kindVisible: boolean;
  courseId: number;
}

/** Lab context the mentor may use: name, description, scenario and the current step only. */
interface MentorLabContext {
  labName: string;
  description: string | null;
  scenarioIntro: string | null;
  currentStep: Pick<LabStepV2, 'title' | 'instructions'> | null;
  allStepsPassed: boolean;
}

export interface AiMentorServiceDeps {
  repo: Pick<LabsRepository, 'findLabById' | 'findProLabByLabId' | 'listLabActivity'>;
  lessons: { findMentorLesson: (lessonId: number) => Promise<MentorLessonRow | null> };
  courseAccess: Pick<CourseAccessService, 'getCourseAccess'>;
  entitlement: Pick<EntitlementService, 'assertLabAccess'>;
  llm: Pick<LlmApiAdapter, 'streamCompletion'>;
  model: string;
  systemPrompt: string;
  sessionTtlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
}

/** Lesson item lookup (lesson -> module -> course) with its publish state. Content of lab and quiz items is NULL. */
async function findMentorLesson(lessonId: number): Promise<MentorLessonRow | null> {
  const rows = await db
    .select({
      lessonId: lessons.lessonId,
      title: lessons.title,
      content: lessons.content,
      contentType: lessons.contentType,
      labId: lessons.labId,
      quizId: lessons.quizId,
      isPublished: lessons.isPublished,
      modulePublished: modules.isPublished,
      coursePublished: academyCourses.isPublished,
      labActive: labs.isActive,
      quizPublished: quizzes.isPublished,
      courseId: modules.courseId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.moduleId))
    .innerJoin(academyCourses, eq(academyCourses.courseId, modules.courseId))
    .leftJoin(labs, eq(labs.labId, lessons.labId))
    .leftJoin(quizzes, eq(quizzes.quizId, lessons.quizId))
    .where(eq(lessons.lessonId, lessonId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const kindVisible =
    row.contentType === 'lab'
      ? row.labId !== null && row.labActive === true
      : row.contentType === 'quiz'
        ? row.quizId !== null && row.quizPublished === true
        : true;
  return {
    lessonId: row.lessonId,
    title: row.title,
    content: row.contentType === 'lab' || row.contentType === 'quiz' ? null : row.content,
    labId: row.labId,
    isPublished: row.isPublished,
    modulePublished: row.modulePublished,
    coursePublished: row.coursePublished,
    kindVisible,
    courseId: row.courseId,
  };
}

function defaultDeps(): AiMentorServiceDeps {
  return {
    repo: labsRepository,
    lessons: { findMentorLesson },
    courseAccess: courseAccessService,
    entitlement: entitlementService,
    llm: llmApiAdapter,
    model: env.AI_MENTOR_MODEL,
    systemPrompt: env.AI_MENTOR_SYSTEM_PROMPT,
    sessionTtlSeconds: env.AI_MENTOR_SESSION_TTL_SECONDS,
    rateLimitMax: env.AI_MENTOR_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AI_MENTOR_RATE_LIMIT_WINDOW_SECONDS,
  };
}

/** Normalises an optional id: anything that is not a positive integer means "not given". */
function normalizeId(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Session scope: the lesson when given, else the lab, else the general
 * dashboard mentor (contracts D28 / 4.1).
 */
function sessionScope(lessonId: number | null, labId: number | null): string {
  if (lessonId !== null) {
    return String(lessonId);
  }
  return labId !== null ? `lab-${labId}` : 'general';
}

/** Same layout as `cacheKeys.aiMentorSession`, keyed by the string scope. */
function sessionKey(userId: number, scope: string): string {
  return `ai_mentor:${userId}:${scope}`;
}

/** Resolved, access-checked context for one request. Only server-approved text reaches the prompt. */
interface MentorContext {
  lessonId: number | null;
  labId: number | null;
  lesson: { title: string; content: string | null } | null;
  lab: MentorLabContext | null;
}

/**
 * F6 §09 AI Mentor: Redis-backed conversational sessions, a rolling per-user
 * rate limit, and a streaming LLM completion whose tokens are yielded to the
 * controller (SSE). Real completions only: the adapter throws 503 when the LLM
 * API is not configured.
 *
 * Access (D28): a lesson must be a published item the user can access; a lab
 * must be active and pass the entitlement check. The prompt carries the lesson
 * text, the lab name, description, scenario intro and the CURRENT step's
 * instructions only. Checks, setup, answers and hints (revealed or not) are
 * never sent to the LLM.
 */
export class AiMentorService {
  constructor(private readonly deps: AiMentorServiceDeps = defaultDeps()) {}

  async getSession(
    userId: number,
    lessonId: number | null | undefined,
    labId: number | null | undefined,
  ): Promise<AiMentorSessionDto> {
    const context = await this.resolveContext(userId, normalizeId(lessonId), normalizeId(labId));
    const session = await this.loadSession(userId, context);
    return this.toSessionDto(session);
  }

  async clearSession(
    userId: number,
    lessonId: number | null | undefined,
    labId: number | null | undefined = null,
  ): Promise<void> {
    const scope = sessionScope(normalizeId(lessonId), normalizeId(labId));
    await redisClient.del(sessionKey(userId, scope));
  }

  /**
   * Streams the mentor reply token-by-token. The user message is persisted
   * to the Redis session before streaming; the assistant reply is appended
   * (and the session TTL refreshed) once the stream completes.
   */
  async *sendMessage(
    userId: number,
    lessonId: number | null | undefined,
    labId: number | null | undefined,
    message: string,
  ): AsyncGenerator<string> {
    const context = await this.resolveContext(userId, normalizeId(lessonId), normalizeId(labId));
    await this.assertRateLimit(userId);

    const session = await this.loadSession(userId, context);
    session.messages.push({ role: 'user', content: message });

    const llmMessages = this.buildLlmMessages(session, context);

    let reply = '';
    try {
      for await (const token of this.deps.llm.streamCompletion(llmMessages)) {
        reply += token;
        yield token;
      }
    } catch (error) {
      await this.saveSession(session);
      throw error;
    }
    session.messages.push({ role: 'assistant', content: reply });
    await this.saveSession(session);

    await activityLogService.recordEvent(userId, 'AI_MENTOR_SESSION', {
      lessonId: context.lessonId,
      labId: context.labId,
      sessionKey: session.sessionKey,
      messageLength: message.length,
    });
  }

  /* ── Access and context ──────────────────────────────────────────────── */

  /**
   * Validates every id the request names and collects the approved context.
   * No ids means general mode (no course, lesson or lab content at all).
   */
  private async resolveContext(
    userId: number,
    lessonId: number | null,
    labId: number | null,
  ): Promise<MentorContext> {
    let lesson: MentorLessonRow | null = null;
    if (lessonId !== null) {
      lesson = await this.deps.lessons.findMentorLesson(lessonId);
      if (!lesson || !lesson.isPublished || !lesson.modulePublished || !lesson.coursePublished || !lesson.kindVisible) {
        throw new NotFoundError('Lesson not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
      }
      const access = await this.deps.courseAccess.getCourseAccess(
        { userId, ipAddress: null, userAgent: null },
        lesson.courseId,
      );
      if (!access.canAccess) {
        const accessMessage = access.message ?? 'You do not have access to this course.';
        throw new ForbiddenError(accessMessage, [
          { code: ERROR_CODES.COURSE_ACCESS_DENIED, reason: access.reason, message: accessMessage },
        ]);
      }
    }

    let lab: MentorLabContext | null = null;
    if (labId !== null) {
      const labRow = await this.deps.repo.findLabById(labId);
      if (!labRow || !labRow.isActive) {
        throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
      }
      await this.deps.entitlement.assertLabAccess(userId, labId);
      if (lesson && lesson.labId !== labId) {
        throw new ValidationError('The lesson does not belong to this lab.');
      }
      lab = await this.loadLabContext(userId, labId, labRow.labName, labRow.description);
    }

    return {
      lessonId,
      labId,
      lesson: lesson ? { title: lesson.title, content: lesson.content } : null,
      lab,
    };
  }

  /** Lab name, description, scenario intro and the learner's current step (instructions only). */
  private async loadLabContext(
    userId: number,
    labId: number,
    labName: string,
    description: string | null,
  ): Promise<MentorLabContext> {
    const proLab = await this.deps.repo.findProLabByLabId(labId);
    const parsed = parseLabSpec(proLab?.flagValues ?? null);
    if (parsed.kind !== 'v2') {
      return { labName, description, scenarioIntro: null, currentStep: null, allStepsPassed: false };
    }
    const spec: LabSpecV2 = parsed.spec;
    const passed = await this.deps.repo.listLabActivity(userId, labId, ['LAB_STEP_PASSED']);
    const passedStepIds = new Set(
      passed.map((row) => row.details?.stepId).filter((stepId): stepId is string => typeof stepId === 'string'),
    );
    const currentStep = spec.steps.find((step) => !passedStepIds.has(step.id)) ?? null;
    return {
      labName,
      description,
      scenarioIntro: spec.scenario.intro,
      currentStep: currentStep ? { title: currentStep.title, instructions: currentStep.instructions } : null,
      allStepsPassed: currentStep === null,
    };
  }

  /* ── Session persistence ─────────────────────────────────────────────── */

  private async loadSession(userId: number, context: MentorContext): Promise<StoredSession> {
    const key = sessionKey(userId, sessionScope(context.lessonId, context.labId));
    const raw = await redisClient.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredSession;
        if (
          parsed.userId === userId &&
          parsed.contextLessonId === context.lessonId &&
          parsed.contextLabId === context.labId
        ) {
          return parsed;
        }
      } catch {
        // corrupted session: fall through and rebuild
      }
    }
    return {
      sessionKey: `mentor_${userId}_${sessionScope(context.lessonId, context.labId)}_${randomBytes(4).toString('hex')}`,
      userId,
      contextLessonId: context.lessonId,
      contextLabId: context.labId,
      createdAt: new Date().toISOString(),
      ttlSeconds: this.deps.sessionTtlSeconds,
      messages: [],
    };
  }

  private async saveSession(session: StoredSession): Promise<void> {
    await redisClient.set(
      sessionKey(session.userId, sessionScope(session.contextLessonId, session.contextLabId)),
      JSON.stringify(session),
      'EX',
      this.deps.sessionTtlSeconds,
    );
  }

  private toSessionDto(session: StoredSession): AiMentorSessionDto {
    return {
      sessionKey: session.sessionKey,
      contextLessonId: session.contextLessonId,
      contextLabId: session.contextLabId,
      createdAt: session.createdAt,
      ttlSeconds: session.ttlSeconds,
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: session.createdAt,
      })),
    };
  }

  /* ── Rate limit ──────────────────────────────────────────────────────── */

  private async assertRateLimit(userId: number): Promise<void> {
    const key = `ai_mentor_rate:${userId}`;
    const count = await redisClient.incr(key);
    // Also repairs a key whose EXPIRE failed earlier, so a budget can never stick forever (D26).
    if (count === 1 || (await redisClient.ttl(key)) < 0) {
      await redisClient.expire(key, this.deps.rateLimitWindowSeconds);
    }
    if (count > this.deps.rateLimitMax) {
      throw new AppError(
        'You have reached the AI Mentor limit for this period. Please try again later.',
        HTTP_STATUS.TOO_MANY_REQUESTS,
      );
    }
  }

  /* ── Prompt construction ─────────────────────────────────────────────── */

  /**
   * General mode sends the bare system prompt. Lesson and lab modes add only
   * the approved context: lesson text, lab name and description, scenario
   * intro and the current step's instructions.
   */
  private buildLlmMessages(
    session: StoredSession,
    context: MentorContext,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const sections: string[] = [];
    if (context.lesson) {
      sections.push(`Lesson: ${context.lesson.title}`);
      const content = context.lesson.content ?? 'No lesson content available.';
      sections.push(`Lesson content:\n${content.slice(0, CONTEXT_CHARS)}`);
    }
    if (context.lab) {
      sections.push(
        `Active lab: ${context.lab.labName}\n${context.lab.description ?? ''}`.slice(0, 1000),
      );
      if (context.lab.scenarioIntro) {
        sections.push(`Lab scenario:\n${context.lab.scenarioIntro.slice(0, CONTEXT_CHARS)}`);
      }
      if (context.lab.currentStep) {
        sections.push(
          `Current step: ${context.lab.currentStep.title}\n${context.lab.currentStep.instructions.slice(0, CONTEXT_CHARS)}`,
        );
      } else if (context.lab.allStepsPassed) {
        sections.push('The learner has passed every step of this lab.');
      }
    }
    const system =
      sections.length > 0
        ? `${this.deps.systemPrompt}\n\n## Context\n${sections.join('\n\n')}`
        : this.deps.systemPrompt;

    const history = session.messages.slice(-HISTORY_WINDOW);
    return [{ role: 'system', content: system }, ...history];
  }
}

export const aiMentorService = new AiMentorService();
