import { describe, expect, it } from 'vitest';
import {
  addMySkillSchema,
  updateMyProfileSchema,
  updateMySettingsSchema,
} from '../../src/features/users/validators/user.validator';
import {
  adminUserListQuerySchema,
  auditLogQuerySchema,
  banUserSchema,
  updateSettingSchema,
} from '../../src/features/admin/validators/admin.validator';

describe('USR-02 UpdateProfileSchema (F2 §07)', () => {
  it('accepts a valid partial update', () => {
    const parsed = updateMyProfileSchema.parse({ bio: 'DevOps engineer', isPublic: true });
    expect(parsed.bio).toBe('DevOps engineer');
    expect(parsed.isPublic).toBe(true);
  });

  it('rejects an invalid website URL', () => {
    expect(() => updateMyProfileSchema.parse({ website: 'not-a-url' })).toThrow();
  });

  it('rejects an invalid linkedinUrl and accepts empty (nullable) URLs', () => {
    expect(() => updateMyProfileSchema.parse({ linkedinUrl: 'nope' })).toThrow();
    expect(updateMyProfileSchema.parse({ linkedinUrl: null }).linkedinUrl).toBeNull();
  });

  it('enforces field length caps from the contract', () => {
    expect(() => updateMyProfileSchema.parse({ fullName: 'X' })).toThrow();
    expect(() => updateMyProfileSchema.parse({ fullName: 'x'.repeat(101) })).toThrow();
    expect(() => updateMyProfileSchema.parse({ bio: 'x'.repeat(1001) })).toThrow();
    expect(() => updateMyProfileSchema.parse({ discordUsername: 'x'.repeat(101) })).toThrow();
  });

  it('rejects negative or zero countryId and enforces isPublic boolean', () => {
    expect(() => updateMyProfileSchema.parse({ countryId: 0 })).toThrow();
    expect(() => updateMyProfileSchema.parse({ countryId: -5 })).toThrow();
    expect(updateMyProfileSchema.parse({ countryId: 12 }).countryId).toBe(12);
    expect(() => updateMyProfileSchema.parse({ isPublic: 'yes' })).toThrow();
  });

  it('strips unknown keys and rejects an empty body', () => {
    const parsed = updateMyProfileSchema.parse({ fullName: 'Jane Doe', hackerField: 1 });
    expect(parsed).not.toHaveProperty('hackerField');
    expect(() => updateMyProfileSchema.parse({})).toThrow('At least one field must be provided.');
  });
});

describe('USR-06 AddSkillSchema (F2 §07)', () => {
  it('accepts default proficiency and yearsExperience', () => {
    const parsed = addMySkillSchema.parse({ skillId: 3 });
    expect(parsed).toEqual({ skillId: 3 });
  });

  it('rejects unknown proficiency levels and negative years', () => {
    expect(() => addMySkillSchema.parse({ skillId: 3, proficiencyLevel: 'master' })).toThrow();
    expect(() => addMySkillSchema.parse({ skillId: 3, yearsExperience: -1 })).toThrow();
    expect(() => addMySkillSchema.parse({ skillId: 0 })).toThrow();
  });
});

describe('USR-09 UpdateMySettingsSchema', () => {
  it('requires the settings array envelope', () => {
    const parsed = updateMySettingsSchema.parse({
      settings: [{ key: 'theme', value: 'dark' }],
    });
    expect(parsed.settings).toHaveLength(1);
    expect(() => updateMySettingsSchema.parse([{ key: 'theme', value: 'dark' }])).toThrow();
    expect(() => updateMySettingsSchema.parse({ settings: [] })).toThrow();
  });

  it('rejects malformed keys', () => {
    expect(() =>
      updateMySettingsSchema.parse({ settings: [{ key: 'Not-A-Key!', value: 1 }] }),
    ).toThrow();
  });
});

describe('ADM-03 BanUserSchema (F2 §07)', () => {
  it('requires a reason of 10–1000 characters', () => {
    expect(() => banUserSchema.parse({ banReason: 'short' })).toThrow();
    expect(() => banUserSchema.parse({ banReason: 'x'.repeat(1001) })).toThrow();
    expect(banUserSchema.parse({ banReason: 'Repeated abuse' }).banReason).toBe('Repeated abuse');
  });

  it('strips extra keys', () => {
    const parsed = banUserSchema.parse({ banReason: 'Repeated abuse', evil: true });
    expect(parsed).not.toHaveProperty('evil');
  });
});

describe('ADM-01 AdminUserListQuerySchema (F2 §07)', () => {
  it('defaults pagination and coerces query strings', async () => {
    const parsed = await adminUserListQuerySchema.parse({ page: '2', pageSize: '10' });
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(10);
  });

  it('validates isBanned/isActive enums and strips unknown params', async () => {
    const parsed = await adminUserListQuerySchema.parse({ isBanned: 'true', nope: 1 });
    expect(parsed.isBanned).toBe('true');
    expect(parsed).not.toHaveProperty('nope');
    expect(() => adminUserListQuerySchema.parse({ isBanned: 'maybe' })).toThrow();
  });
});

describe('ADM-07 AuditLogQuerySchema + ADM-09 UpdateSettingSchema', () => {
  it('accepts date strings and action filters', async () => {
    const parsed = await auditLogQuerySchema.parse({ from: '2026-07-01', to: '2026-07-31', action: 'ban_user' });
    expect(parsed.from).toBe('2026-07-01');
    expect(parsed.to).toBe('2026-07-31');
    expect(parsed.action).toBe('ban_user');
  });

  it('passes through arbitrary setting values', () => {
    expect(updateSettingSchema.parse({ settingValue: { value: 6 } }).settingValue).toEqual({ value: 6 });
    expect(updateSettingSchema.parse({ settingValue: 'text' }).settingValue).toBe('text');
  });
});