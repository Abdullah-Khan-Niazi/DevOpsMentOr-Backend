import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { trackService } from '../services/TrackService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/** F6 §08 HTTP handling for the track catalog and progress (LAB-13..15). */
export class TrackController {
  /** LAB-13 */
  async listTracks(_req: Request, res: Response): Promise<Response> {
    const tracks = await trackService.listTracks();
    return sendSuccess(res, { tracks }, 'Tracks retrieved successfully.');
  }

  /** LAB-14: optional identity so item completion is resolved for signed-in users. */
  async getTrackDetail(req: Request, res: Response): Promise<Response> {
    const track = await trackService.getTrackDetail(
      Number(req.params.trackId),
      req.user ? Number(req.user.sub) : null,
    );
    return sendSuccess(res, { track }, 'Track retrieved successfully.');
  }

  /** LAB-15 */
  async getTrackProgress(req: Request, res: Response): Promise<Response> {
    const progress = await trackService.getTrackProgress(
      userId(req),
      Number(req.params.trackId),
    );
    return sendSuccess(res, progress, 'Track progress retrieved successfully.');
  }
}

export const trackController = new TrackController();