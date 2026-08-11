import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { cacheKeys, redisClient } from '../../../app/cache/redis';
import { db, userRoles, users, roles } from '../../../app/database';
import { ROLES } from '../../../shared/constants';
import { BadRequestError, ConflictError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { env } from '../../../app/config/env';
import { passwordService } from '../../../shared/services';
import type {
  AcceptAdminInviteDto,
  AdminInviteDto,
  PendingAdminInvite,
} from '../dto/auth.dto';

/**
 * Platform admin invitation lifecycle.
 *
 * Invitation tokens are stored in Redis (`admin_invite:{token}`) with the
 * invitee email, full name and expiry. The `otp_codes` table cannot host the
 * invite sentinel (user_id FK is NOT NULL in devops_db.sql), so Redis is the
 * sanctioned store for this transient primitive, consistent with the F1
 * contract's Redis-backed session/revocation primitives.
 */
export class AdminInviteService {
  private readonly ttlSeconds: number;

  constructor() {
    this.ttlSeconds = env.INVITE_TTL_HOURS * 60 * 60;
  }

  async sendInvite(input: AdminInviteDto): Promise<void> {
    const existing = await this.findExistingAdminByEmail(input.email);

    if (existing) {
      throw new ConflictError('This user is already a platform admin.');
    }

    const pending = await this.findPendingByEmail(input.email);
    if (pending) {
      throw new ConflictError('A pending invitation already exists for this email.');
    }

    const token = randomUUID();
    const payload = JSON.stringify({
      email: input.email,
      fullName: input.fullName,
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    });

    await redisClient.set(cacheKeys.adminInvite(token), payload, 'EX', this.ttlSeconds);
  }

  async acceptInvite(input: AcceptAdminInviteDto): Promise<void> {
    const raw = await redisClient.get(cacheKeys.adminInvite(input.token));

    if (!raw) {
      throw new BadRequestError('This invitation is invalid or has expired.');
    }

    const invite = JSON.parse(raw) as { email: string; fullName: string; expiresAt: string };

    if (invite.email !== input.email) {
      throw new BadRequestError('The invitation does not match this email address.');
    }

    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      await redisClient.del(cacheKeys.adminInvite(input.token));
      throw new BadRequestError('This invitation has expired.');
    }

    const role = await db.query.roles.findFirst({
      where: eq(roles.roleName, ROLES.PLATFORM_ADMIN),
    });

    if (!role) {
      throw new Error('platform_admin role is not seeded.');
    }

    const passwordHash = await passwordService.hash(input.password);

    await db.transaction(async (tx) => {
      const inserted = await tx.insert(users).values({
        username: input.username,
        email: input.email,
        passwordHash,
        salt: '',
        fullName: input.fullName,
        isVerified: true,
        isActive: true,
        isBanned: false,
        deletedAt: null,
      });

      const userId = inserted[0]?.insertId;
      if (!userId) {
        throw new Error('Failed to create invited admin user.');
      }

      await tx.insert(userRoles).values({ userId, roleId: role.roleId });
    });

    await redisClient.del(cacheKeys.adminInvite(input.token));
    logger.info({ email: input.email }, 'Platform admin invitation accepted');
  }

  async revokeInvite(token: string): Promise<void> {
    const removed = await redisClient.del(cacheKeys.adminInvite(token));
    if (removed === 0) {
      throw new BadRequestError('Invitation not found or already consumed.');
    }
  }

  async listPending(): Promise<PendingAdminInvite[]> {
    const keys = await redisClient.keys(`${cacheKeys.adminInvite('*')}`);

    if (keys.length === 0) {
      return [];
    }

    const values = await redisClient.mget(keys);
    const invites: PendingAdminInvite[] = [];

    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as { email: string; fullName: string; expiresAt: string };
      invites.push({
        id: keys[i].replace(cacheKeys.adminInvite(''), ''),
        email: parsed.email,
        fullName: parsed.fullName,
        expiresAt: parsed.expiresAt,
      });
    }

    return invites;
  }

  private async findExistingAdminByEmail(email: string): Promise<boolean> {
    const adminRole = await db.query.roles.findFirst({
      where: eq(roles.roleName, ROLES.PLATFORM_ADMIN),
    });

    if (!adminRole) {
      return false;
    }

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      return false;
    }

    const rows = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, user.userId),
          eq(userRoles.roleId, adminRole.roleId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async findPendingByEmail(email: string): Promise<PendingAdminInvite | null> {
    const invites = await this.listPending();
    return invites.find((invite) => invite.email === email) ?? null;
  }
}

export const adminInviteService = new AdminInviteService();