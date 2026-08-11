import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { AcceptAdminInviteDto, AdminInviteDto } from '../dto/auth.dto';
import { adminInviteService } from '../services/admin-invite.service';

export class AdminInviteController {
  async send(req: Request, res: Response): Promise<Response> {
    await adminInviteService.sendInvite(req.body as AdminInviteDto);
    return sendSuccess(res, null, 'Invitation sent successfully.', HTTP_STATUS.CREATED);
  }

  async list(_req: Request, res: Response): Promise<Response> {
    const invites = await adminInviteService.listPending();
    return sendSuccess(res, invites, 'Pending invitations retrieved.', HTTP_STATUS.OK);
  }

  async accept(req: Request, res: Response): Promise<Response> {
    await adminInviteService.acceptInvite(req.body as AcceptAdminInviteDto);
    return sendSuccess(res, null, 'Admin account created successfully.', HTTP_STATUS.OK);
  }

  async revoke(req: Request, res: Response): Promise<Response> {
    const inviteId = req.params.inviteId as string;
    await adminInviteService.revokeInvite(inviteId);
    return sendSuccess(res, null, 'Invitation revoked.', HTTP_STATUS.OK);
  }
}

export const adminInviteController = new AdminInviteController();