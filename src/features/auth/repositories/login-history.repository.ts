import { db, loginHistory } from '../../../app/database';

export interface ILoginHistoryRepository {
  create(data: {
    userId: number;
    ipAddress?: string;
    userAgent?: string;
    loginType: 'email' | 'google' | 'github' | 'enterprise_sso';
    isSuccessful: boolean;
    failureReason?: string;
  }): Promise<void>;
}

export class LoginHistoryRepository implements ILoginHistoryRepository {
  async create(data: {
    userId: number;
    ipAddress?: string;
    userAgent?: string;
    loginType: 'email' | 'google' | 'github' | 'enterprise_sso';
    isSuccessful: boolean;
    failureReason?: string;
  }): Promise<void> {
    await db.insert(loginHistory).values({
      userId: data.userId,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      loginType: data.loginType,
      isSuccessful: data.isSuccessful,
      failureReason: data.failureReason ?? null,
    });
  }
}

export const loginHistoryRepository = new LoginHistoryRepository();
