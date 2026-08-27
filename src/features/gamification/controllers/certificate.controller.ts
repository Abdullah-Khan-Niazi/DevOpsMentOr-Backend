import type { Request, Response } from 'express';
import { ROLES } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { certificateService } from '../services/certificate.service';

/** F7 §08 HTTP handling for certificate download and public verification. */
export class CertificateController {
  /** GAM-13: owner-only download (IDOR: `user_id = session.userId` unless admin). */
  async getDownloadUrl(req: Request, res: Response): Promise<Response> {
    const isAdmin = req.user?.roles.includes(ROLES.PLATFORM_ADMIN) ?? false;
    const result = await certificateService.getDownloadUrl(
      Number(req.user?.sub),
      Number(req.params.certId),
      isAdmin,
    );
    return sendSuccess(res, result, 'Certificate download URL retrieved successfully.');
  }

  /** GAM-14: public, unauthenticated certificate verification. */
  async verify(req: Request, res: Response): Promise<Response> {
    const verification = await certificateService.verify(
      req.params.certNumber,
      req.ip,
    );
    return sendSuccess(res, verification, 'Certificate verification completed.');
  }
}

export const certificateController = new CertificateController();