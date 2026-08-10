import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { AdminActor, AdminListFilter, AdminUserDetailDto, AdminUserListItem, PaginatedAdminData, PlatformAdminDto } from '../dto/admin.dto';
import type { IAdminUserRepository } from '../repositories/admin-user.repository';
import { adminUserRepository } from '../repositories/admin-user.repository';
import type { AuditLogService } from './audit-log.service';
import { auditLogService } from './audit-log.service';

export class AdminUserService {
  constructor(
    private readonly admins: IAdminUserRepository = adminUserRepository,
    private readonly audit: AuditLogService = auditLogService,
  ) {}

  async listUsers(filter: AdminListFilter): Promise<PaginatedAdminData<AdminUserListItem>> {
    const { data, rolesByUser, total } = await this.admins.list(filter);

    const items: AdminUserListItem[] = data.map((user) => ({
      userId: user.userId,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      isActive: user.isActive,
      isBanned: user.isBanned,
      isVerified: user.isVerified,
      roles: rolesByUser.get(user.userId) ?? [],
      createdAt: user.createdAt.toISOString(),
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    }));

    return {
      data: items,
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / filter.pageSize),
    };
  }

  async getUserDetail(userId: number): Promise<AdminUserDetailDto> {
    const detail = await this.admins.findDetail(userId);
    if (!detail) {
      throw new NotFoundError('User not found.');
    }
    return detail;
  }

  async banUser(
    actor: AdminActor,
    targetUserId: number,
    banReason: string,
  ): Promise<{ message: string }> {
    const target = await this.admins.findDetail(targetUserId);
    if (!target) {
      throw new NotFoundError('User not found.');
    }

    if (target.roles.includes(ROLES.PLATFORM_ADMIN)) {
      throw new ForbiddenError('CANNOT_BAN_ADMIN');
    }

    const before = { isBanned: target.isBanned, banReason: target.banReason };
    await this.admins.setBan(targetUserId, true, banReason);

    await this.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.BAN_USER,
      targetType: 'user',
      targetId: targetUserId,
      changes: { before, after: { isBanned: true, banReason } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { message: 'User banned successfully.' };
  }

  async unbanUser(actor: AdminActor, targetUserId: number): Promise<{ message: string }> {
    const target = await this.admins.findDetail(targetUserId);
    if (!target) {
      throw new NotFoundError('User not found.');
    }

    if (!target.isBanned) {
      throw new BadRequestError('User is not banned.');
    }

    const before = { isBanned: true, banReason: target.banReason };
    await this.admins.setBan(targetUserId, false, null);

    await this.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UNBAN_USER,
      targetType: 'user',
      targetId: targetUserId,
      changes: { before, after: { isBanned: false, banReason: null } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { message: 'User unbanned successfully.' };
  }

  async deleteUser(actor: AdminActor, targetUserId: number): Promise<{ message: string }> {
    const target = await this.admins.findDetail(targetUserId);
    if (!target) {
      throw new NotFoundError('User not found.');
    }

    if (target.deletedAt) {
      throw new BadRequestError('User is already deleted.');
    }

    const before = { deletedAt: null };
    await this.admins.softDelete(targetUserId);

    await this.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.DELETE_USER,
      targetType: 'user',
      targetId: targetUserId,
      changes: { before, after: { deletedAt: new Date().toISOString() } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { message: 'User deleted successfully.' };
  }

  async listPlatformAdmins(): Promise<PlatformAdminDto[]> {
    return this.admins.listPlatformAdmins();
  }
}

export const adminUserService = new AdminUserService();