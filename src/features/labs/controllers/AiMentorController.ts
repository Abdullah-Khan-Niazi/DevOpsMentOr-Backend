import type { Request, Response } from 'express';
import { aiMentorService } from '../services/AiMentorService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/**
 * F6 §09 AI Mentor HTTP + SSE orchestration. The stream contract is
 * `text/event-stream` with `data: {"delta":"..."}` events and a final
 * `data: {"done":true}` event (LAB-11).
 */
export class AiMentorController {
  /** LAB-11 */
  async sendMessage(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = aiMentorService.sendMessage(
        userId(req),
        req.body.lessonId,
        req.body.labId ?? null,
        req.body.message,
      );
      for await (const token of stream) {
        res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
      res.end();
    }
  }

  /** LAB-11 companion: current session payload for the drawer. */
  async getSession(req: Request, res: Response): Promise<Response> {
    const session = await aiMentorService.getSession(
      userId(req),
      Number(req.query.lessonId),
      req.query.labId ? Number(req.query.labId) : null,
    );
    res.setHeader('Content-Type', 'application/json');
    return res.json(session);
  }

  /** LAB-12 */
  async clearSession(req: Request, res: Response): Promise<Response> {
    await aiMentorService.clearSession(userId(req), req.body.lessonId);
    res.setHeader('Content-Type', 'application/json');
    return res.json({ success: true, message: 'AI Mentor conversation cleared.' });
  }
}

export const aiMentorController = new AiMentorController();