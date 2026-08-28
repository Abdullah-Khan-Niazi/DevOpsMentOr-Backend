import { env } from '../../../app/config';
import { AppError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * F6 §08 abstract adapter for the LLM provider API. Streams response tokens
 * as an async iterable so the controller can relay `text/event-stream`
 * chunks to the client.
 *
 * BLOCKING condition (F6 §12): the API URL and key MUST come from
 * `LLM_API_URL` / `LLM_API_KEY` in `.env`. When unset the adapter fails with
 * a user-safe 503. Model selection and the AI Mentor system prompt wording
 * are env-driven (`AI_MENTOR_MODEL`, `AI_MENTOR_SYSTEM_PROMPT`) and are not
 * decided here (F6 §12).
 */
export class LlmApiAdapter {
  async *streamCompletion(messages: LlmChatMessage[]): AsyncGenerator<string> {
    if (!env.LLM_API_URL || !env.LLM_API_KEY) {
      logger.error('LLM API is not configured.');
      throw new AppError('AI Mentor is temporarily unavailable.', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const response = await fetch(`${env.LLM_API_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MENTOR_MODEL || undefined,
        stream: true,
        messages,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok || !response.body) {
      logger.error({ status: response.status }, 'LLM provider request failed');
      throw new AppError('AI Mentor is temporarily unavailable.', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              yield token;
            }
          } catch {
            // Ignore malformed keep-alive chunks; streaming continues.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const llmApiAdapter = new LlmApiAdapter();