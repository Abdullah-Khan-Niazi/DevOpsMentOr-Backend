import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { HTTP_STATUS } from '../../../shared/constants';
import { adminLabService, type AdminActor } from '../services/AdminLabService';

function actorFrom(req: Request): AdminActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** F6 §08 admin surface (LAB-16..LAB-22), gated at the router layer. */
export class AdminLabController {
  /** List all labs for admin console */
  async listLabs(_req: Request, res: Response): Promise<Response> {
    const labs = await adminLabService.listLabsAdmin();
    return sendSuccess(res, { labs }, 'Labs retrieved successfully.');
  }

  /** List all tracks for admin console */
  async listTracks(_req: Request, res: Response): Promise<Response> {
    const tracks = await adminLabService.listTracksAdmin();
    return sendSuccess(res, { tracks }, 'Tracks retrieved successfully.');
  }

  /** LAB-16 */
  async createLab(req: Request, res: Response): Promise<Response> {
    const lab = await adminLabService.createLab(actorFrom(req), req.body);
    return sendSuccess(res, { lab }, 'Lab created successfully.', HTTP_STATUS.CREATED);
  }

  /** LAB-17 */
  async updateLab(req: Request, res: Response): Promise<Response> {
    const lab = await adminLabService.updateLab(actorFrom(req), Number(req.params.labId), req.body);
    return sendSuccess(res, { lab }, 'Lab updated successfully.');
  }

  /** LAB-18 */
  async publishLab(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.publishLab(
      actorFrom(req),
      Number(req.params.labId),
      req.body.isActive,
    );
    return sendSuccess(res, result, result.isActive ? 'Lab published.' : 'Lab unpublished.');
  }

  /** LAB-19 */
  async createTrack(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.createTrack(actorFrom(req), req.body);
    return sendSuccess(res, { track }, 'Track created successfully.', HTTP_STATUS.CREATED);
  }

  /** LAB-20 */
  async updateTrack(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.updateTrack(
      actorFrom(req),
      Number(req.params.trackId),
      req.body,
    );
    return sendSuccess(res, { track }, 'Track updated successfully.');
  }

  /** LAB-21 */
  async listInstances(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.listInstancesAdmin(
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 20),
      { status: req.query.status as never, search: req.query.search as string | undefined },
    );
    return sendSuccess(res, result, 'Lab instances retrieved successfully.');
  }

  /** LAB-22 */
  async terminateInstance(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.terminateInstanceAdmin(
      actorFrom(req),
      Number(req.params.instanceId),
      req.body.reason,
    );
    return sendSuccess(res, result, 'Lab instance terminated successfully.');
  }
}

export const adminLabController = new AdminLabController();