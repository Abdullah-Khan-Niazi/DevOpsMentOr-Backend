import { randomUUID } from 'crypto';
import { cacheKeys, redisClient } from '../../../app/cache/redis';
import { env } from '../../../app/config/env';
import { logger } from '../../../shared/logger';
import { emailService } from '../../../shared/services';
import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { AdminActor, AdminListFilter, AdminUserDetailDto, AdminUserListItem, PaginatedAdminData, PlatformAdminDto } from '../dto/admin.dto';
import type { IAdminUserRepository } from '../repositories/admin-user.repository';
import { adminUserRepository } from '../repositories/admin-user.repository';
import type { ISessionRepository } from '../../auth/repositories/session.repository';
import { sessionRepository } from '../../auth/repositories/session.repository';
import type { AuditLogService } from './audit-log.service';
import { auditLogService } from './audit-log.service';

export class AdminUserService {
  constructor(
    private readonly admins: IAdminUserRepository = adminUserRepository,
    private readonly audit: AuditLogService = auditLogService,
    private readonly sessionsRepo: ISessionRepository = sessionRepository,
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
      organizationId: user.organizationId ?? null,
      organizationName: user.organizationName ?? null,
      country: user.country ?? null,
    }));

    return {
      data: items,
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / filter.pageSize),
    };
  }

  async inviteUsers(
    actor: AdminActor,
    payload: {
      emails: string[];
      type: 'individual_learner' | 'organization';
      organizationId?: number;
      role?: 'individual_learner' | 'org_admin' | 'professor' | 'org_student' | 'platform_admin';
    },
  ): Promise<{ sent: number; failed: number }> {
    if (payload.role === 'platform_admin') {
      // Platform admins are invited through the dedicated admin-invite flow,
      // which has its own namespace and confirmation semantics. Member invites
      // must never mint platform administrators.
      throw new ForbiddenError(
        'Platform administrators cannot be invited through member invitations.',
      );
    }

    let sent = 0;
    let failed = 0;
    const roleToAssign = payload.role ?? (payload.type === 'organization' ? 'org_student' : 'individual_learner');

    for (const email of payload.emails) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) continue;
      try {
        const token = randomUUID();
        const invitePayload = JSON.stringify({
          email: normalized,
          type: payload.type,
          organizationId: payload.organizationId ?? null,
          role: roleToAssign,
          invitedBy: actor.userId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        });
        // Member invites live in their own namespace; the platform-admin
        // accept endpoint only reads `admin_invite:*`, so a member token can
        // never be redeemed for platform privileges.
        await redisClient.set(cacheKeys.userInvite(token), invitePayload, 'EX', 72 * 3600);

        const inviteUrl = `${env.FRONTEND_URL}/register?token=${token}&email=${encodeURIComponent(normalized)}`;
        await emailService.sendInvitationEmail(normalized, inviteUrl, token);
        sent++;
      } catch (err) {
        logger.error({ err, email: normalized }, 'Failed to dispatch user invite');
        failed++;
      }
    }

    await this.audit.record({
      adminUserId: actor.userId,
      actorEmail: actor.email ?? null,
      action: AUDIT_ACTIONS.CREATE_USER,
      targetType: 'user_invites',
      targetId: payload.organizationId ?? null,
      changes: { type: payload.type, count: payload.emails.length, sent, failed, role: roleToAssign },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { sent, failed };
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
    // A ban must take effect immediately, including already-issued tokens.
    await this.sessionsRepo.deactivateAllForUser(targetUserId);

    await this.audit.record({
      adminUserId: actor.userId,
      actorEmail: actor.email ?? null,
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
    // Unban only clears pre-existing sessions (e.g. left over from data
    // written before ban-time revocation); the user must sign in afresh.
    await this.sessionsRepo.deactivateAllForUser(targetUserId);

    await this.audit.record({
      adminUserId: actor.userId,
      actorEmail: actor.email ?? null,
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
    // Soft deletion is a revocation too: no session may outlive the account.
    await this.sessionsRepo.deactivateAllForUser(targetUserId);

    await this.audit.record({
      adminUserId: actor.userId,
      actorEmail: actor.email ?? null,
      action: AUDIT_ACTIONS.DELETE_USER,
      targetType: 'user',
      targetId: targetUserId,
      changes: { before, after: { deletedAt: new Date().toISOString() } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { message: 'User deleted successfully.' };
  }

  async restoreUser(actor: AdminActor, targetUserId: number): Promise<{ message: string }> {
    const target = await this.admins.findDetail(targetUserId);
    if (!target) {
      throw new NotFoundError('User not found.');
    }

    if (!target.deletedAt) {
      throw new BadRequestError('User is not deleted.');
    }

    const before = { deletedAt: target.deletedAt };
    await this.admins.restore(targetUserId);

    await this.audit.record({
      adminUserId: actor.userId,
      actorEmail: actor.email ?? null,
      action: AUDIT_ACTIONS.RESTORE_USER,
      targetType: 'user',
      targetId: targetUserId,
      changes: { before, after: { deletedAt: null } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { message: 'User restored successfully.' };
  }

  async listPlatformAdmins(): Promise<PlatformAdminDto[]> {
    return this.admins.listPlatformAdmins();
  }
}

export const adminUserService = new AdminUserService();