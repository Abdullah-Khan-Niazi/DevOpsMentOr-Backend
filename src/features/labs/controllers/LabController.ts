import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { HTTP_STATUS } from '../../../shared/constants';
import type { VpnRegion } from '../dto/labs.dto';
import { labService } from '../services/LabService';
import { vpnService } from '../services/VpnService';

function userId(req: Request): number {
  return Number(req.user?.sub);
}

/** F6 §08 HTTP handling for the lab catalog and instance lifecycle. */
export class LabController {
  /** LAB-01 */
  async listLabs(_req: Request, res: Response): Promise<Response> {
    const labs = await labService.listLabs();
    return sendSuccess(res, { labs }, 'Labs retrieved successfully.');
  }

  /** LAB-02: optional identity so `isStarted` is resolved for signed-in users. */
  async getLabDetail(req: Request, res: Response): Promise<Response> {
    const lab = await labService.getLabDetail(
      Number(req.params.labId),
      req.user ? Number(req.user.sub) : null,
    );
    return sendSuccess(res, { lab }, 'Lab retrieved successfully.');
  }

  /** LAB-03 */
  async provisionInstance(req: Request, res: Response): Promise<Response> {
    const instance = await labService.provisionInstance(
      userId(req),
      Number(req.params.labId),
      req.body.region ?? null,
    );
    return sendSuccess(res, { instance }, 'Lab instance provisioned successfully.', HTTP_STATUS.CREATED);
  }

  /** LAB-04 */
  async getActiveInstance(req: Request, res: Response): Promise<Response> {
    const instance = await labService.getActiveInstance(userId(req));
    return sendSuccess(res, { instance }, 'Active instance retrieved successfully.');
  }

  /** LAB-05 */
  async stopInstance(req: Request, res: Response): Promise<Response> {
    const result = await labService.stopInstance(userId(req), Number(req.params.instanceId));
    return sendSuccess(res, result, 'Lab instance stopped successfully.');
  }

  /** LAB-06 */
  async terminateInstance(req: Request, res: Response): Promise<Response> {
    const result = await labService.terminateInstance(userId(req), Number(req.params.instanceId));
    return sendSuccess(res, result, 'Lab instance terminated successfully.');
  }

  /** LAB-07 */
  async extendInstance(req: Request, res: Response): Promise<Response> {
    const result = await labService.extendInstance(userId(req), Number(req.params.instanceId));
    return sendSuccess(res, result, 'Lab instance extended successfully.');
  }
}

/** F6 §08 VPN config delivery (LAB-10). */
export class VpnController {
  async getConfig(req: Request, res: Response): Promise<Response> {
    const config = await vpnService.getOrCreateAssignment(
      userId(req),
      req.query.region ? (String(req.query.region) as VpnRegion) : null,
    );
    return sendSuccess(res, { config }, 'VPN configuration retrieved successfully.');
  }

  /** Signed `.ovpn` download served as an attachment (LAB-10 detail). */
  async downloadOvpn(req: Request, res: Response): Promise<Response> {
    const { fileName, content } = await vpnService.getOvpnConfigForDownload(
      userId(req),
      Number(req.params.assignmentId),
      String(req.query.exp ?? ''),
      String(req.query.sig ?? ''),
    );
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(content);
  }
}

export const labController = new LabController();
export const vpnController = new VpnController();