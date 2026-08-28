import { and, eq, gt, lt, or } from 'drizzle-orm';
import { db, otpCodes } from '../../../app/database';

export type OtpCodeType = 'email_verification' | 'password_reset' | 'two_factor' | 'phone_verification';

export interface OtpRecord {
  otpId: number;
  userId: number;
  code: string;
  type: OtpCodeType;
  isUsed: boolean;
  expiresAt: Date;
}

export interface IOtpRepository {
  create(data: { userId: number; code: string; type: OtpCodeType; expiresAt: Date }): Promise<void>;
  findActiveCode(userId: number, type: OtpCodeType, code: string): Promise<OtpRecord | null>;
  findByUserIdAndType(userId: number, type: OtpCodeType, code: string): Promise<OtpRecord | null>;
  markUsed(otpId: number): Promise<void>;
}

export class OtpRepository implements IOtpRepository {
  async create(data: {
    userId: number;
    code: string;
    type: OtpCodeType;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(otpCodes).values({
      userId: data.userId,
      code: data.code,
      type: data.type,
      expiresAt: data.expiresAt,
      isUsed: false,
    });
  }

  async findActiveCode(
    userId: number,
    type: OtpCodeType,
    code: string,
  ): Promise<OtpRecord | null> {
    const rows = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.userId, userId),
          eq(otpCodes.type, type),
          eq(otpCodes.code, code),
          eq(otpCodes.isUsed, false),
          gt(otpCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findByUserIdAndType(
    userId: number,
    type: OtpCodeType,
    code: string,
  ): Promise<OtpRecord | null> {
    const rows = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.userId, userId),
          eq(otpCodes.type, type),
          eq(otpCodes.code, code),
          or(eq(otpCodes.isUsed, true), lt(otpCodes.expiresAt, new Date())),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async markUsed(otpId: number): Promise<void> {
    await db.update(otpCodes).set({ isUsed: true }).where(eq(otpCodes.otpId, otpId));
  }
}

export const otpRepository = new OtpRepository();