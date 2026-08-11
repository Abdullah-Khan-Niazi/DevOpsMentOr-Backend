import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import type { CreateApiTokenDto } from '../dto/auth.dto';
import { apiTokenService } from '../services/api-token.service';

export class ApiTokenController {
  async list(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const tokens = await apiTokenService.list(userId);
    return sendSuccess(res, tokens, 'API tokens retrieved.', HTTP_STATUS.OK);
  }

  async create(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const token = await apiTokenService.create(userId, req.body as CreateApiTokenDto);
    return sendSuccess(res, token, 'API token created.', HTTP_STATUS.CREATED);
  }

  async revoke(req: Request, res: Response): Promise<Response> {
    const userId = Number(req.user?.sub);
    const tokenId = Number(req.params.tokenId);

    await apiTokenService.revoke(userId, tokenId);
    return sendSuccess(res, null, 'API token revoked.', HTTP_STATUS.OK);
  }
}

export const apiTokenController = new ApiTokenController();