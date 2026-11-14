import { describe, expect, it, vi } from 'vitest';
import { updateMySettingsSchema } from '../../../src/features/users/validators/user.validator';
import { inviteUserSchema } from '../../../src/features/admin/validators/admin.validator';
import { UserService } from '../../../src/features/users/services/user.service';
import { BadRequestError } from '../../../src/shared/errors';
import type { IUserSettingRepository } from '../../../src/features/users/repositories/user-setting.repository';

describe('SEC-01 regression — user settings allowlist', () => {
  it('rejects org_id with an actionable message', () => {
    const parsed = updateMySettingsSchema.safeParse({
      settings: [{ key: 'org_id', value: 2 }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/managed by the platform/i);
    }
  });

  it('rejects role/plan namespaces', () => {
    for (const key of ['role', 'plan', 'platform.admin', 'org.1.role']) {
      const parsed = updateMySettingsSchema.safeParse({
        settings: [{ key, value: 'x' }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('accepts the documented writable preferences', () => {
    const parsed = updateMySettingsSchema.safeParse({
      settings: [
        { key: 'theme', value: 'dark' },
        { key: 'timezone', value: 'UTC' },
        { key: 'notify_email', value: 'true' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('service defense-in-depth rejects server-owned keys before writing anything', async () => {
    const settingsRepo = {
      listByUser: vi.fn(async () => []),
      upsert: vi.fn(async () => undefined),
      upsertMany: vi.fn(async () => undefined),
    } as unknown as IUserSettingRepository;

    const service = new UserService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsRepo,
      {} as never,
    );

    await expect(
      service.updateSettings(1, [{ key: 'org_id', value: 3 }]),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(settingsRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('service writes allowed keys atomically through upsertMany', async () => {
    const settingsRepo = {
      listByUser: vi.fn(async () => [
        { settingKey: 'theme', settingValue: 'dark' },
      ]),
      upsert: vi.fn(async () => undefined),
      upsertMany: vi.fn(async () => undefined),
    } as unknown as IUserSettingRepository;

    const service = new UserService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsRepo,
      {} as never,
    );

    const result = await service.updateSettings(1, [{ key: 'theme', value: 'dark' }]);
    expect(settingsRepo.upsertMany).toHaveBeenCalledWith(1, [
      { settingKey: 'theme', settingValue: 'dark' },
    ]);
    expect(result).toEqual([{ settingKey: 'theme', settingValue: 'dark' }]);
  });
});

describe('SEC-03 regression — member invites cannot mint platform admins', () => {
  it('rejects platform_admin in the member invite payload', () => {
    const parsed = inviteUserSchema.safeParse({
      emails: ['student@example.com'],
      type: 'organization',
      organizationId: 1,
      role: 'platform_admin',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a legitimate org_student invite', () => {
    const parsed = inviteUserSchema.safeParse({
      emails: ['student@example.com'],
      type: 'organization',
      organizationId: 1,
      role: 'org_student',
    });
    expect(parsed.success).toBe(true);
  });
});
