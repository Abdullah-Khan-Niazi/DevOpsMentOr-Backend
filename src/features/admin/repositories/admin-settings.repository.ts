import { asc, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { systemSettings } from '../../../app/database/schema';
import type { SystemSettingDto } from '../dto/admin.dto';

export interface IAdminSettingsRepository {
  listAll(): Promise<SystemSettingDto[]>;
  findByKey(key: string): Promise<SystemSettingDto | null>;
  update(key: string, settingValue: unknown, updatedBy: number): Promise<SystemSettingDto>;
}

export class AdminSettingsRepository implements IAdminSettingsRepository {
  async listAll(): Promise<SystemSettingDto[]> {
    const rows = await db
      .select()
      .from(systemSettings)
      .orderBy(asc(systemSettings.groupName), asc(systemSettings.settingKey));

    return rows.map((row) => ({
      settingId: row.settingId,
      settingKey: row.settingKey,
      settingValue: row.settingValue,
      groupName: row.groupName,
      description: row.description,
      isEditable: row.isEditable,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    }));
  }

  async findByKey(key: string): Promise<SystemSettingDto | null> {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.settingKey, key),
    });

    if (!row) {
      return null;
    }

    return {
      settingId: row.settingId,
      settingKey: row.settingKey,
      settingValue: row.settingValue,
      groupName: row.groupName,
      description: row.description,
      isEditable: row.isEditable,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  async update(key: string, settingValue: unknown, updatedBy: number): Promise<SystemSettingDto> {
    await db
      .update(systemSettings)
      .set({ settingValue, updatedBy })
      .where(eq(systemSettings.settingKey, key));

    const updated = await this.findByKey(key);
    if (!updated) {
      throw new Error('System setting update failed.');
    }
    return updated;
  }
}

export const adminSettingsRepository = new AdminSettingsRepository();