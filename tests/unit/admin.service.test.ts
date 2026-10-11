import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestError, NotFoundError } from '../../src/shared/errors';
import { AUDIT_ACTIONS, ROLES } from '../../src/shared/constants';
import { AdminUserService } from '../../src/features/admin/services/admin-user.service';
import { AdminSettingsService } from '../../src/features/admin/services/admin-settings.service';
import { AdminDashboardService } from '../../src/features/admin/services/admin-dashboard.service';
import type { AdminUserDetailDto, AdminActor } from '../../src/features/admin/dto/admin.dto';

const cacheMock = vi.hoisted(() => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => 'OK'),
}));

vi.mock('../../src/app/cache/redis', () => ({
  cacheKeys: { adminDashboard: () => 'admin_kpi' },
  redisClient: { get: cacheMock.get, set: cacheMock.set },
}));

const actor: AdminActor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

const detail = (overrides: Partial<AdminUserDetailDto> = {}): AdminUserDetailDto => ({
  userId: 2,
  email: 'bob@example.com',
  username: 'bobby',
  fullName: 'Bob Smith',
  isActive: true,
  isBanned: false,
  isVerified: false,
  roles: [],
  createdAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  lastLoginAt: null,
  loginHistory: [],
  ...overrides,
});

describe('AdminUserService (F2)', () => {
  let adminsRepo: {
    list: ReturnType<typeof vi.fn>;
    findDetail: ReturnType<typeof vi.fn>;
    setBan: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    listPlatformAdmins: ReturnType<typeof vi.fn>;
  };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: AdminUserService;

  beforeEach(() => {
    adminsRepo = {
      list: vi.fn(async () => ({ data: [], rolesByUser: new Map(), total: 0 })),
      findDetail: vi.fn(async () => detail()),
      setBan: vi.fn(async () => undefined),
      softDelete: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      listPlatformAdmins: vi.fn(async () => []),
    };
    audit = { record: vi.fn(async () => undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AdminUserService(adminsRepo as any, audit as any);
  });

  describe('listUsers', () => {
    it('wraps rows into the paginated envelope shape', async () => {
      const createdAt = new Date('2026-01-02T00:00:00.000Z');
      const deletedAt = new Date('2026-01-03T00:00:00.000Z');
      adminsRepo.list.mockResolvedValueOnce({
        data: [
          { userId: 2, email: 'bob@example.com', username: 'bobby', fullName: 'Bob Smith', isActive: true, isBanned: false, isVerified: false, createdAt, deletedAt },
          { userId: 3, email: 'eve@example.com', username: 'eve', fullName: 'Eve', isActive: true, isBanned: true, isVerified: true, createdAt, deletedAt: null },
        ],
        rolesByUser: new Map([[2, ['individual_learner'] as string[]]]),
        total: 2,
      });

      const result = await service.listUsers({ page: 1, pageSize: 10, search: undefined, role: undefined, status: undefined });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].deletedAt).toBe(deletedAt.toISOString());
      expect(result.data[0].roles).toEqual(['individual_learner']);
      expect(result.totalPages).toBe(1);
    });

    it('computes totalPages from the full count', async () => {
      adminsRepo.list.mockResolvedValueOnce({ data: [], rolesByUser: new Map(), total: 42 });
      const result = await service.listUsers({ page: 2, pageSize: 10 });
      expect(result.totalPages).toBe(5);
    });
  });

  describe('getUserDetail', () => {
    it('throws 404 when the user does not exist', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(null);
      await expect(service.getUserDetail(77)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('includes login history', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ loginHistory: [{ ipAddress: '10.0.0.1', loginAt: '2026-01-01T00:00:00.000Z' }] }));
      const result = await service.getUserDetail(2);
      expect(result.loginHistory).toHaveLength(1);
    });
  });

  describe('banUser', () => {
    it('persists the ban and records an audit entry', async () => {
      const result = await service.banUser(actor, 2, 'Spam');

      expect(adminsRepo.setBan).toHaveBeenCalledWith(2, true, 'Spam');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 9,
          action: AUDIT_ACTIONS.BAN_USER,
          targetType: 'user',
          targetId: 2,
        }),
      );
      expect(result.message).toBe('User banned successfully.');
    });

    it('rejects banning a platform admin with CANNOT_BAN_ADMIN', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ roles: [ROLES.PLATFORM_ADMIN] }));
      await expect(service.banUser(actor, 2, 'Spam')).rejects.toMatchObject({ statusCode: 403, message: 'CANNOT_BAN_ADMIN' });
      expect(adminsRepo.setBan).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws 404 for a missing target', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(null);
      await expect(service.banUser(actor, 99, 'Spam')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('unbanUser', () => {
    it('rejects unbanning a user who is not banned', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ isBanned: false }));
      await expect(service.unbanUser(actor, 2)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('clears the ban and records an audit entry', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ isBanned: true, banReason: 'Spam' }));
      const result = await service.unbanUser(actor, 2);

      expect(adminsRepo.setBan).toHaveBeenCalledWith(2, false, null);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.UNBAN_USER }));
      expect(result.message).toBe('User unbanned successfully.');
    });
  });

  describe('deleteUser', () => {
    it('rejects deleting an already-deleted user', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ deletedAt: '2026-01-05T00:00:00.000Z' }));
      await expect(service.deleteUser(actor, 2)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('soft deletes and records an audit entry', async () => {
      const result = await service.deleteUser(actor, 2);
      expect(adminsRepo.softDelete).toHaveBeenCalledWith(2);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.DELETE_USER }));
      expect(result.message).toBe('User deleted successfully.');
    });
  });

  describe('restoreUser', () => {
    it('rejects restoring a user who is not deleted', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ deletedAt: null }));
      await expect(service.restoreUser(actor, 2)).rejects.toBeInstanceOf(BadRequestError);
    });

    it('restores a deleted user and records an audit entry', async () => {
      adminsRepo.findDetail.mockResolvedValueOnce(detail({ deletedAt: '2026-01-05T00:00:00.000Z' }));
      const result = await service.restoreUser(actor, 2);
      expect(adminsRepo.restore).toHaveBeenCalledWith(2);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.RESTORE_USER }));
      expect(result.message).toBe('User restored successfully.');
    });
  });
});

describe('AdminSettingsService (F2)', () => {
  let settingsRepo: {
    listAll: ReturnType<typeof vi.fn>;
    findByKey: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let audit: { record: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    settingsRepo = {
      listAll: vi.fn(async () => []),
      findByKey: vi.fn(async () => null),
      update: vi.fn(async () => ({
        settingId: 1,
        settingKey: 'platform.avatar.max_size_mb',
        settingValue: 5,
        isEditable: true,
        updatedBy: 9,
        updatedAt: '2026-01-02T00:00:00.000Z',
      })),
    };
    audit = { record: vi.fn(async () => undefined) };
  });

  it('throws 404 for an unknown setting key', async () => {
    const service = new AdminSettingsService(settingsRepo as never, audit as never);
    await expect(service.update(actor, 'nope', 4)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects editing a read-only setting with SETTING_NOT_EDITABLE', async () => {
    settingsRepo.findByKey.mockResolvedValueOnce({ settingId: 2, settingKey: 'platform.build.version', settingValue: '1.0.0', isEditable: false });
    const service = new AdminSettingsService(settingsRepo as never, audit as never);
    await expect(service.update(actor, 'platform.build.version', '2.0.0')).rejects.toMatchObject({ statusCode: 403, message: 'SETTING_NOT_EDITABLE' });
    expect(settingsRepo.update).not.toHaveBeenCalled();
  });

  it('persists an editable setting and records an audit entry', async () => {
    settingsRepo.findByKey.mockResolvedValueOnce({ settingId: 1, settingKey: 'platform.avatar.max_size_mb', settingValue: 5, isEditable: true });
    const service = new AdminSettingsService(settingsRepo as never, audit as never);

    const result = await service.update(actor, 'platform.avatar.max_size_mb', 6);

    expect(settingsRepo.update).toHaveBeenCalledWith('platform.avatar.max_size_mb', 6, 9);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.UPDATE_SETTING }));
    expect(result.settingValue).toBe(5);
  });
});

describe('AdminDashboardService (F2)', () => {
  let repo: { getKpis: ReturnType<typeof vi.fn>; getRecentAuditLogs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cacheMock.get.mockReset();
    cacheMock.set.mockReset();
    cacheMock.get.mockResolvedValue(null);
    repo = {
      getKpis: vi.fn(async () => ({ totalLearners: 3, activeLearners: 1, totalOrganizations: 2, labsCompleted: null })),
      getRecentAuditLogs: vi.fn(async () => []),
    };
  });

  it('returns KPIs from cache when a cached snapshot exists', async () => {
    cacheMock.get.mockResolvedValueOnce(
      JSON.stringify({
        kpis: { totalLearners: 999, activeLearners: 0, totalOrganizations: 0, labsCompleted: null },
        recentAuditLogs: [],
      }),
    );
    const service = new AdminDashboardService(repo as never);
    const result = await service.getKPIs();

    expect(result.kpis.totalLearners).toBe(999);
    expect(repo.getKpis).not.toHaveBeenCalled();
  });

  it('computes KPIs from the DB and writes the cache', async () => {
    const service = new AdminDashboardService(repo as never);
    const result = await service.getKPIs();

    expect(repo.getKpis).toHaveBeenCalled();
    expect(cacheMock.set).toHaveBeenCalled();
    expect(result.kpis.totalOrganizations).toBe(2);
    expect(result.kpis.labsCompleted).toBeNull();
  });
});