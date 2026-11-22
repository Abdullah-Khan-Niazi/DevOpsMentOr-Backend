import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { HTTP_STATUS, PERMISSIONS } from '../../../shared/constants';
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

  /** Labs catalog entries joined to the imported labs. */
  async catalog(req: Request, res: Response): Promise<Response> {
    const labs = await adminLabService.catalog(Boolean(req.query.unusedOnly));
    return sendSuccess(res, { labs }, 'Catalog retrieved successfully.');
  }

  /** `POST /admin/labs/import`: 201 for a new lab, 200 for a re-import. */
  async importLab(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.importFromCatalog(actorFrom(req), req.body.slug);
    return sendSuccess(
      res,
      result,
      result.created ? 'Lab imported successfully.' : 'Lab re-imported successfully.',
      result.created ? HTTP_STATUS.CREATED : HTTP_STATUS.OK,
    );
  }

  /** Live editor validation; invalid input is reported in the body, never as 422. */
  async validateSpec(req: Request, res: Response): Promise<Response> {
    const result = adminLabService.validateSpec(req.body.spec);
    return sendSuccess(res, result, 'Spec validated.');
  }

  async getLab(req: Request, res: Response): Promise<Response> {
    const lab = await adminLabService.getLab(Number(req.params.labId));
    return sendSuccess(res, { lab }, 'Lab retrieved successfully.');
  }

  async saveSpec(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.saveSpec(actorFrom(req), Number(req.params.labId), req.body.spec);
    return sendSuccess(res, result, 'Lab spec saved successfully.');
  }

  async deleteLab(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.deleteLab(actorFrom(req), Number(req.params.labId));
    return sendSuccess(res, result, 'Lab deleted successfully.');
  }

  async testCheck(req: Request, res: Response): Promise<Response> {
    const result = await adminLabService.testCheck(
      actorFrom(req),
      Number(req.params.labId),
      req.body,
      req.user?.permissions.includes(PERMISSIONS.PLATFORM_LABS_ADMIN) === true,
    );
    return sendSuccess(res, result, 'Check evaluated.');
  }

  /** List all tracks for admin console */
  async listTracks(_req: Request, res: Response): Promise<Response> {
    const tracks = await adminLabService.listTracksAdmin();
    return sendSuccess(res, { tracks }, 'Tracks retrieved successfully.');
  }

  async getTrack(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.getTrack(Number(req.params.trackId));
    return sendSuccess(res, { track }, 'Track retrieved successfully.');
  }

  async attachTrackContent(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.attachTrackContent(
      actorFrom(req),
      Number(req.params.trackId),
      req.body,
    );
    return sendSuccess(res, { track }, 'Course added to the track.', HTTP_STATUS.CREATED);
  }

  async updateTrackContent(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.updateTrackContent(
      actorFrom(req),
      Number(req.params.trackId),
      Number(req.params.courseId),
      req.body,
    );
    return sendSuccess(res, { track }, 'Track content updated.');
  }

  async detachTrackContent(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.detachTrackContent(
      actorFrom(req),
      Number(req.params.trackId),
      Number(req.params.courseId),
    );
    return sendSuccess(res, { track }, 'Course removed from the track.');
  }

  async reorderTrackContent(req: Request, res: Response): Promise<Response> {
    const track = await adminLabService.reorderTrackContent(
      actorFrom(req),
      Number(req.params.trackId),
      req.body.courseIds,
    );
    return sendSuccess(res, { track }, 'Track content reordered.');
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