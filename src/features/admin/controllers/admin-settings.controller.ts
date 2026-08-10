import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import type { AdminActor } from '../dto/admin.dto';
import { adminSettingsService } from '../services/admin-settings.service';

export class AdminSettingsController {
  async list(_req: Request, res: Response): Promise<Response> {
    const settings = await adminSettingsService.list();
    return sendSuccess(res, settings, 'System settings retrieved successfully.');
  }

  async update(req: Request, res: Response): Promise<Response> {
    const actor: AdminActor = {
      userId: Number(req.user?.sub),
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
    const updated = await adminSettingsService.update(
      actor,
      req.params.key,
      req.body.settingValue,
    );
    return sendSuccess(res, updated, 'Setting updated successfully.');
  }
}

export const adminSettingsController = new AdminSettingsController();