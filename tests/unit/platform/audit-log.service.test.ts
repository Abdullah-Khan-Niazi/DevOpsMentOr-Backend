import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const inserted: Record<string, unknown>[] = [];

  const values = vi.fn(async (payload: Record<string, unknown>) => {
    inserted.push(payload);
  });
  const insert = vi.fn(() => ({ values }));

  return { inserted, insert };
});

vi.mock('../../../src/app/database', () => ({
  db: { insert: dbMock.insert },
  auditLogs: {},
}));

import { AuditLogService } from '../../../src/features/admin/services/audit-log.service';

describe('AuditLogService.record', () => {
  beforeEach(() => {
    dbMock.inserted.length = 0;
    dbMock.insert.mockClear();
  });

  it('persists the actor email when provided (durable actor label)', async () => {
    const service = new AuditLogService();

    await service.record({
      adminUserId: 9,
      actorEmail: 'admin@example.com',
      action: 'ban_user',
      targetType: 'user',
      targetId: 2,
      changes: { before: { isBanned: false }, after: { isBanned: true } },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(dbMock.inserted).toHaveLength(1);
    expect(dbMock.inserted[0]).toMatchObject({
      adminUserId: 9,
      actorEmail: 'admin@example.com',
      action: 'ban_user',
      targetType: 'user',
      targetId: 2,
      ipAddress: '127.0.0.1',
    });
  });

  it('persists null when the actor email is not available', async () => {
    const service = new AuditLogService();

    await service.record({
      adminUserId: 9,
      action: 'update_setting',
      targetType: 'system_setting',
      targetId: 1,
      changes: null,
      ipAddress: null,
      userAgent: null,
    });

    expect(dbMock.inserted[0].actorEmail).toBeNull();
  });
});
