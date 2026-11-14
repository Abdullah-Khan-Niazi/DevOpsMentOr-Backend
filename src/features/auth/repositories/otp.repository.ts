import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { db, otpCodes } from '../../../app/database';
import { otpHashService } from '../services/otp-hash.service';

export type OtpCodeType = 'email_verification' | 'password_reset' | 'two_factor' | 'phone_verification';

export interface OtpRecord {
  otpId: number;
  userId: number;
  /** HMAC-SHA256 hex digest as stored at rest; never the raw code. */
  code: string;
  type: OtpCodeType;
  isUsed: boolean;
  attempts: number;
  expiresAt: Date;
}

export interface IOtpRepository {
  create(data: { userId: number; code: string; type: OtpCodeType; expiresAt: Date }): Promise<void>;
  findActiveCode(userId: number, type: OtpCodeType, code: string): Promise<OtpRecord | null>;
  findByUserIdAndType(userId: number, type: OtpCodeType, code: string): Promise<OtpRecord | null>;
  /** Newest still-active OTP for a user/type pair (used for failure counters). */
  findLatestActive(userId: number, type: OtpCodeType): Promise<OtpRecord | null>;
  /** Increments `attempts` and returns the new counter value. */
  incrementAttempts(otpId: number): Promise<number>;
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
      code: otpHashService.hash(data.code),
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
          eq(otpCodes.code, otpHashService.hash(code)),
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
          eq(otpCodes.code, otpHashService.hash(code)),
          or(eq(otpCodes.isUsed, true), lt(otpCodes.expiresAt, new Date())),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findLatestActive(userId: number, type: OtpCodeType): Promise<OtpRecord | null> {
    const rows = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.userId, userId),
          eq(otpCodes.type, type),
          eq(otpCodes.isUsed, false),
          gt(otpCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpCodes.otpId))
      .limit(1);

    return rows[0] ?? null;
  }

  async incrementAttempts(otpId: number): Promise<number> {
    await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.otpId, otpId));

    const rows = await db
      .select({ attempts: otpCodes.attempts })
      .from(otpCodes)
      .where(eq(otpCodes.otpId, otpId))
      .limit(1);

    return rows[0]?.attempts ?? 1;
  }

  async markUsed(otpId: number): Promise<void> {
    await db.update(otpCodes).set({ isUsed: true }).where(eq(otpCodes.otpId, otpId));
  }
}

export const otpRepository = new OtpRepository();
