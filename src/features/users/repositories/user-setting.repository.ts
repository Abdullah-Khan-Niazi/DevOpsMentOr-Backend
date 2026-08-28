import { eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { userSettings } from '../../../app/database/schema';
import type { UserSettingDto } from '../dto/user.dto';

export interface IUserSettingRepository {
  listByUser(userId: number): Promise<UserSettingDto[]>;
  upsert(userId: number, settingKey: string, settingValue: unknown): Promise<void>;
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
    await db
      .insert(userSettings)
      .values({ userId, settingKey, settingValue })
      .onDuplicateKeyUpdate({ set: { settingValue } });
  }
}

export const userSettingRepository = new UserSettingRepository();