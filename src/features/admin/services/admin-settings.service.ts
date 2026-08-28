import { AUDIT_ACTIONS } from '../../../shared/constants';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { AdminActor, SystemSettingDto } from '../dto/admin.dto';
import type { IAdminSettingsRepository } from '../repositories/admin-settings.repository';
import { adminSettingsRepository } from '../repositories/admin-settings.repository';
import type { AuditLogService } from './audit-log.service';
import { auditLogService } from './audit-log.service';

export class AdminSettingsService {
  constructor(
    private readonly settings: IAdminSettingsRepository = adminSettingsRepository,
    private readonly audit: AuditLogService = auditLogService,
  ) {}

  async list(): Promise<SystemSettingDto[]> {
    return this.settings.listAll();
  }

  async update(
    actor: AdminActor,
    key: string,
    settingValue: unknown,
  ): Promise<SystemSettingDto> {
    const existing = await this.settings.findByKey(key);
    if (!existing) {
      throw new NotFoundError('Setting not found.');
    }

    if (!existing.isEditable) {
      throw new ForbiddenError('SETTING_NOT_EDITABLE');
    }

    const updated = await this.settings.update(key, settingValue, actor.userId);

    await this.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UPDATE_SETTING,
      targetType: 'system_setting',
      targetId: existing.settingId,
      changes: {
        before: { settingValue: existing.settingValue },
        after: { settingValue },
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return updated;
  }
}

export const adminSettingsService = new AdminSettingsService();