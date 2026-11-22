import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { sherlockService } from '../services/SherlockService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/** HTTP handling for Sherlock forensics (LAB-09). */
export class SherlockController {
  async submitAnswers(req: Request, res: Response): Promise<Response> {
    const result = await sherlockService.submitAnswers(
      userId(req),
      Number(req.params.labId),
      req.body.answers,
    );
    return sendSuccess(res, result, 'Sherlock answers evaluated.');
  }
}

export const sherlockController = new SherlockController();
