import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { assertionService } from '../services/AssertionService';
import { sherlockService } from '../services/SherlockService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/** F6 §06§08 HTTP handling for the assertion engine and Sherlock forensics. */
export class AssertionController {
  /** LAB-08 */
  async runChecks(req: Request, res: Response): Promise<Response> {
    const result = await assertionService.runChecks(userId(req), Number(req.params.instanceId));
    return sendSuccess(res, result, 'Assertion checks completed.');
  }
}

export class SherlockController {
  /** LAB-09 */
  async submitAnswers(req: Request, res: Response): Promise<Response> {
    const result = await sherlockService.submitAnswers(
      userId(req),
      Number(req.params.labId),
      req.body.answers,
    );
    return sendSuccess(res, result, 'Sherlock answers evaluated.');
  }
}

export const assertionController = new AssertionController();
export const sherlockController = new SherlockController();