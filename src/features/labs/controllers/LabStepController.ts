import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { labStepService } from '../services/LabStepService';
import { slidesService } from '../services/SlidesService';
import { walkthroughService } from '../services/WalkthroughService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/** HTTP handling for the learner lab steps (contracts 4.1): state, stage, check, hint reveal, walkthrough. */
export class LabStepController {
  async getState(req: Request, res: Response): Promise<Response> {
    const state = await labStepService.getState(userId(req), Number(req.params.labId));
    return sendSuccess(res, { state }, 'Lab steps retrieved successfully.');
  }

  async stage(req: Request, res: Response): Promise<Response> {
    const stage = await labStepService.stage(
      userId(req),
      Number(req.params.instanceId),
      String(req.params.stepId),
    );
    return sendSuccess(res, { stage }, 'Step environment prepared.');
  }

  async check(req: Request, res: Response): Promise<Response> {
    const result = await labStepService.check(
      userId(req),
      Number(req.params.instanceId),
      String(req.params.stepId),
      req.body.answer,
    );
    return sendSuccess(res, { result }, 'Step checked.');
  }

  async reveal(req: Request, res: Response): Promise<Response> {
    const hint = await labStepService.revealHint(
      userId(req),
      Number(req.params.labId),
      String(req.params.stepId),
      Number(req.params.hintIndex),
    );
    return sendSuccess(res, { hint }, 'Hint revealed.');
  }

  async slides(req: Request, res: Response): Promise<Response> {
    const slides = await slidesService.getSlides(userId(req), Number(req.params.labId));
    return sendSuccess(res, { slides }, 'Slides retrieved successfully.');
  }

  async walkthrough(req: Request, res: Response): Promise<Response> {
    const walkthrough = await walkthroughService.getWalkthrough(userId(req), Number(req.params.labId));
    return sendSuccess(res, { walkthrough }, 'Walkthrough retrieved successfully.');
  }
}

export const labStepController = new LabStepController();
