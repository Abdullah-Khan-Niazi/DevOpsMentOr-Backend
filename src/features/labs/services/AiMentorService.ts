import { randomBytes } from 'node:crypto';
import { env } from '../../../app/config';
import { redisClient, cacheKeys } from '../../../app/cache/redis';
import { AppError, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { activityLogService } from '../../progress/services/ActivityLogService';
import type { AiMentorSessionDto } from '../dto/labs.dto';
import type { LlmApiAdapter } from '../adapters/llm-api.adapter';
import { llmApiAdapter } from '../adapters/llm-api.adapter';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

/** Internal: newest-history window kept per session to bound prompt size. */
const HISTORY_WINDOW = 20;

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StoredSession {
  sessionKey: string;
  userId: number;
  contextLessonId: number;
  contextLabId: number | null;
  createdAt: string;
  ttlSeconds: number;
  messages: StoredMessage[];
}

export interface AiMentorServiceDeps {
  repo: Pick<LabsRepository, 'findLessonById' | 'findLabById'>;
  llm: Pick<LlmApiAdapter, 'streamCompletion'>;
  model: string;
  systemPrompt: string;
  sessionTtlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
}

function defaultDeps(): AiMentorServiceDeps {
  return {
    repo: labsRepository,
    llm: llmApiAdapter,
    model: env.AI_MENTOR_MODEL,
    systemPrompt: env.AI_MENTOR_SYSTEM_PROMPT,
    sessionTtlSeconds: env.AI_MENTOR_SESSION_TTL_SECONDS,
    rateLimitMax: env.AI_MENTOR_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AI_MENTOR_RATE_LIMIT_WINDOW_SECONDS,
  };
}

/**
 * F6 §09 AI Mentor: Redis-backed conversational sessions (per lesson),
 * a rolling per-user rate limit, and a streaming LLM completion whose tokens
 * are yielded to the controller (SSE). Real completions only — the adapter
 * throws 503 when the LLM API is not configured, and the prompt is built
 * exclusively from the lesson content, lab context and session history.
 */
export class AiMentorService {
  constructor(private readonly deps: AiMentorServiceDeps = defaultDeps()) {}

  async getSession(userId: number, lessonId: number, labId: number | null): Promise<AiMentorSessionDto> {
    const lesson = await this.deps.repo.findLessonById(lessonId);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.');
    }
    const session = await this.loadSession(userId, lessonId, labId);
    return this.toSessionDto(session);
  }

  async clearSession(userId: number, lessonId: number): Promise<void> {
    await redisClient.del(cacheKeys.aiMentorSession(userId, lessonId));
  }

  /**
   * Streams the mentor reply token-by-token. The user message is persisted
   * to the Redis session before streaming; the assistant reply is appended
   * (and the session TTL refreshed) once the stream completes.
   */
  async *sendMessage(
    userId: number,
    lessonId: number,
    labId: number | null,
    message: string,
  ): AsyncGenerator<string> {
    const lesson = await this.deps.repo.findLessonById(lessonId);
    if (!lesson) {
      throw new NotFoundError('Lesson not found.');
    }
    await this.assertRateLimit(userId);

    const session = await this.loadSession(userId, lessonId, labId);
    session.messages.push({ role: 'user', content: message });

    const lab = labId !== null ? await this.deps.repo.findLabById(labId) : null;
    const llmMessages = this.buildLlmMessages(session, lesson, lab);

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
      lessonId,
      labId: labId ?? null,
      sessionKey: session.sessionKey,
      messageLength: message.length,
    });
  }

  /* ── Session persistence ─────────────────────────────────────────────── */

  private async loadSession(
    userId: number,
    lessonId: number,
    labId: number | null,
  ): Promise<StoredSession> {
    const key = cacheKeys.aiMentorSession(userId, lessonId);
    const raw = await redisClient.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed.userId === userId && parsed.contextLessonId === lessonId) {
          return parsed;
        }
      } catch {
        // corrupted session: fall through and rebuild
      }
    }
    return {
      sessionKey: `mentor_${userId}_${lessonId}_${randomBytes(4).toString('hex')}`,
      userId,
      contextLessonId: lessonId,
      contextLabId: labId,
      createdAt: new Date().toISOString(),
      ttlSeconds: this.deps.sessionTtlSeconds,
      messages: [],
    };
  }

  private async saveSession(session: StoredSession): Promise<void> {
    await redisClient.set(
      cacheKeys.aiMentorSession(session.userId, session.contextLessonId),
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
    const key = cacheKeys.aiMentorRate(userId);
    const count = await redisClient.incr(key);
    if (count === 1) {
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

  private buildLlmMessages(
    session: StoredSession,
    lesson: { lessonId: number; title: string; content: string | null },
    lab: { labName: string; description: string | null } | null,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const context: string[] = [
      `Lesson: ${lesson.title}`,
      `Lesson content:\n${(lesson.content ?? 'No lesson content available.').slice(0, 4000)}`,
    ];
    if (lab) {
      context.push(`Active lab context: ${lab.labName} — ${lab.description ?? ''}`.slice(0, 1000));
    }
    const system = `${this.deps.systemPrompt}\n\n## Context\n${context.join('\n\n')}`;

    const history = session.messages.slice(-HISTORY_WINDOW);
    return [{ role: 'system', content: system }, ...history];
  }
}

export const aiMentorService = new AiMentorService();