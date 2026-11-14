import { eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { userSettings } from '../../../app/database/schema';
import type { UserSettingDto } from '../dto/user.dto';

export interface IUserSettingRepository {
  listByUser(userId: number): Promise<UserSettingDto[]>;
  upsert(userId: number, settingKey: string, settingValue: unknown): Promise<void>;
  /**
   * Atomically upserts a batch of user settings. A partial write would leave
   * the user's preferences half-saved with no way to tell which keys landed,
   * so the batch runs inside a single transaction.
   */
  upsertMany(
    userId: number,
    settings: Array<{ settingKey: string; settingValue: unknown }>,
  ): Promise<void>;
}

export class UserSettingRepository implements IUserSettingRepository {
  async listByUser(userId: number): Promise<UserSettingDto[]> {
    const rows = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    return rows.map((row) => ({
      settingKey: row.settingKey,
      settingValue: row.settingValue,
    }));
  }

  async upsert(userId: number, settingKey: string, settingValue: unknown): Promise<void> {
    await this.upsertMany(userId, [{ settingKey, settingValue }]);
  }

  async upsertMany(
    userId: number,
    settings: Array<{ settingKey: string; settingValue: unknown }>,
  ): Promise<void> {
    if (settings.length === 0) {
      return;
    }

    await db.transaction(async (tx) => {
      for (const setting of settings) {
        await tx
          .insert(userSettings)
          .values({
            userId,
            settingKey: setting.settingKey,
            settingValue: setting.settingValue,
          })
          .onDuplicateKeyUpdate({ set: { settingValue: setting.settingValue } });
      }
    });
  }
}

export const userSettingRepository = new UserSettingRepository();