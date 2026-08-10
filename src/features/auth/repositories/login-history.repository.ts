import { desc, eq } from 'drizzle-orm';
import { db, loginHistory } from '../../../app/database';

export interface LoginHistoryRow {
  loginId: number;
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
  loginType: 'email' | 'google' | 'github';
  isSuccessful: boolean;
  failureReason: string | null;
  createdAt: Date;
}

export interface ILoginHistoryRepository {
  create(data: {
    userId: number;
    ipAddress?: string;
    userAgent?: string;
    loginType: 'email' | 'google' | 'github';
    isSuccessful: boolean;
    failureReason?: string;
  }): Promise<void>;
  listByUser(userId: number): Promise<LoginHistoryRow[]>;
}

export class LoginHistoryRepository implements ILoginHistoryRepository {
  async create(data: {
    userId: number;
    ipAddress?: string;
    userAgent?: string;
    loginType: 'email' | 'google' | 'github';
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

  async listByUser(userId: number): Promise<LoginHistoryRow[]> {
    const rows = await db
      .select()
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(50);

    return rows;
  }
}

export const loginHistoryRepository = new LoginHistoryRepository();
