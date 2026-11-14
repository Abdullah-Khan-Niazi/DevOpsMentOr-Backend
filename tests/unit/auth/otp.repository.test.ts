import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { env } from '../../../src/app/config/env';
import { otpHashService } from '../../../src/features/auth/services/otp-hash.service';
import { OtpRepository } from '../../../src/features/auth/repositories/otp.repository';

const dbMock = vi.hoisted(() => {
  const inserted: Record<string, unknown>[] = [];
  const updatedSets: Record<string, unknown>[] = [];
  const selectQueue: unknown[][] = [];

  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn(async (payload: Record<string, unknown>) => {
    inserted.push(payload);
  });
  const insert = vi.fn(() => ({ values }));
  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn((payload: Record<string, unknown>) => {
    updatedSets.push(payload);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set }));

  return { inserted, updatedSets, selectQueue, select, insert, update };
});

vi.mock('../../../src/app/database', async () => {
  // Real schema columns keep the drizzle SQL builders happy without
  // initialising the mysql pool.
  const schema = await import('../../../src/app/database/schema');
  return {
    db: { insert: dbMock.insert, select: dbMock.select, update: dbMock.update },
    otpCodes: schema.otpCodes,
  };
});

describe('OtpRepository (hashed at rest)', () => {
  beforeEach(() => {
    dbMock.inserted.length = 0;
    dbMock.updatedSets.length = 0;
    dbMock.selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.update.mockClear();
  });

  it('stores only the HMAC-SHA256 hex digest, never the raw code', async () => {
    const repo = new OtpRepository();

    await repo.create({
      userId: 1,
      code: '123456',
      type: 'email_verification',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const stored = dbMock.inserted[0];
    expect(stored.code).toBe(otpHashService.hash('123456'));
    expect(stored.code).not.toBe('123456');
    expect(String(stored.code)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('derives the fallback HMAC key from JWT_ACCESS_SECRET when OTP_HASH_SECRET is absent', () => {
    const configured = env.OTP_HASH_SECRET;
    const key =
      configured && configured.length > 0
        ? Buffer.from(configured, 'utf8')
        : createHmac('sha256', env.JWT_ACCESS_SECRET).update('devopsmentor:otp').digest();
    const expected = createHmac('sha256', key).update('123456').digest('hex');

    expect(otpHashService.hash('123456')).toBe(expected);
  });

  it('re-hashes the submitted code when looking up an active OTP', async () => {
    const repo = new OtpRepository();
    const hashSpy = vi.spyOn(otpHashService, 'hash');
    dbMock.selectQueue.push([]);

    await repo.findActiveCode(1, 'email_verification', '123456');

    expect(hashSpy).toHaveBeenCalledWith('123456');
    hashSpy.mockRestore();
  });

  it('re-hashes the submitted code when checking stale OTPs', async () => {
    const repo = new OtpRepository();
    const hashSpy = vi.spyOn(otpHashService, 'hash');
    dbMock.selectQueue.push([]);

    await repo.findByUserIdAndType(1, 'password_reset', '654321');

    expect(hashSpy).toHaveBeenCalledWith('654321');
    hashSpy.mockRestore();
  });

  it('increments the attempt counter atomically and returns the new value', async () => {
    const repo = new OtpRepository();
    dbMock.selectQueue.push([{ attempts: 3 }]);

    const attempts = await repo.incrementAttempts(7);

    expect(attempts).toBe(3);
    expect(dbMock.updatedSets[0]).toHaveProperty('attempts');
  });

  it('returns the newest active OTP for a user/type pair', async () => {
    const repo = new OtpRepository();
    const record = {
      otpId: 9,
      userId: 1,
      code: 'b'.repeat(64),
      type: 'email_verification',
      isUsed: false,
      attempts: 1,
      expiresAt: new Date(Date.now() + 60_000),
    };
    dbMock.selectQueue.push([record]);

    await expect(repo.findLatestActive(1, 'email_verification')).resolves.toEqual(record);
  });
});
