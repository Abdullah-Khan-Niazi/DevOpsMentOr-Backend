import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../../app/database';
import { organizationMemberships, organizations } from '../../../app/database/schema';

export type MembershipRole = 'org_admin' | 'professor' | 'org_student';
export type MembershipStatus = 'active' | 'invited' | 'suspended' | 'left';

export interface MembershipRow {
  membershipId: number;
  organizationId: number;
  userId: number;
  role: MembershipRole;
  status: MembershipStatus;
  isPrimary: boolean;
  joinedAt: Date;
  invitedBy: number | null;
  leftAt: Date | null;
}

export interface MembershipWithOrg extends MembershipRow {
  organizationName: string;
  organizationSlug: string;
}

export interface IMembershipRepository {
  /** Active membership for a user: primary first, then longest-standing. */
  getActiveForUser(userId: number): Promise<MembershipRow | null>;
  getActiveRole(userId: number): Promise<MembershipRole | null>;
  getRoleInOrg(userId: number, organizationId: number): Promise<MembershipRole | null>;
  listActiveForUser(userId: number): Promise<MembershipWithOrg[]>;
  upsert(input: {
    userId: number;
    organizationId: number;
    role: MembershipRole;
    status?: MembershipStatus;
    invitedBy?: number | null;
  }): Promise<void>;
  /** Creates an `active` membership only when none exists; never downgrades. */
  ensureRole(input: {
    userId: number;
    organizationId: number;
    role: MembershipRole;
    invitedBy?: number | null;
  }): Promise<void>;
  setStatus(
    userId: number,
    organizationId: number,
    status: MembershipStatus,
  ): Promise<void>;
  setPrimary(userId: number, organizationId: number): Promise<void>;
  listActiveUserIdsByOrg(organizationId: number): Promise<number[]>;
  countActiveByOrg(organizationId: number): Promise<number>;
}

export class MembershipRepository implements IMembershipRepository {
  async getActiveForUser(userId: number): Promise<MembershipRow | null> {
    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .orderBy(
        desc(organizationMemberships.isPrimary),
        asc(organizationMemberships.joinedAt),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getActiveRole(userId: number): Promise<MembershipRole | null> {
    const membership = await this.getActiveForUser(userId);
    return membership?.role ?? null;
  }

  async getRoleInOrg(userId: number, organizationId: number): Promise<MembershipRole | null> {
    const rows = await db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0]?.role ?? null;
  }

  async listActiveForUser(userId: number): Promise<MembershipWithOrg[]> {
    const rows = await db
      .select({
        membershipId: organizationMemberships.membershipId,
        organizationId: organizationMemberships.organizationId,
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        isPrimary: organizationMemberships.isPrimary,
        joinedAt: organizationMemberships.joinedAt,
        invitedBy: organizationMemberships.invitedBy,
        leftAt: organizationMemberships.leftAt,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.organizationId, organizationMemberships.organizationId),
      )
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .orderBy(
        desc(organizationMemberships.isPrimary),
        asc(organizations.name),
      );
    return rows;
  }

  async upsert(input: {
    userId: number;
    organizationId: number;
    role: MembershipRole;
    status?: MembershipStatus;
    invitedBy?: number | null;
  }): Promise<void> {
    await db
      .insert(organizationMemberships)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        role: input.role,
        status: input.status ?? 'active',
        invitedBy: input.invitedBy ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          role: input.role,
          status: input.status ?? 'active',
          ...(input.invitedBy !== undefined ? { invitedBy: input.invitedBy } : {}),
        },
      });
  }

  async ensureRole(input: {
    userId: number;
    organizationId: number;
    role: MembershipRole;
    invitedBy?: number | null;
  }): Promise<void> {
    await db
      .insert(organizationMemberships)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        role: input.role,
        status: 'active',
        invitedBy: input.invitedBy ?? null,
      })
      .onDuplicateKeyUpdate({
        // Keep an existing (possibly higher) role, but reactivate a lapsed row.
        set: {
          status: 'active',
          leftAt: null,
        },
      });
  }

  async setStatus(
    userId: number,
    organizationId: number,
    status: MembershipStatus,
  ): Promise<void> {
    await db
      .update(organizationMemberships)
      .set({
        status,
        ...(status === 'left' ? { leftAt: new Date(), isPrimary: false } : {}),
      })
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
        ),
      );
  }

  async setPrimary(userId: number, organizationId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(organizationMemberships)
        .set({ isPrimary: false })
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            ne(organizationMemberships.organizationId, organizationId),
          ),
        );
      await tx
        .update(organizationMemberships)
        .set({ isPrimary: true })
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            eq(organizationMemberships.organizationId, organizationId),
          ),
        );
    });
  }

  async listActiveUserIdsByOrg(organizationId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
        ),
      );
    return rows.map((row) => row.userId);
  }

  async countActiveByOrg(organizationId: number): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
        ),
      );
    return Number(row?.value ?? 0);
  }

  /** Roles for several users inside one org (roster UI enrichment). */
  async getRolesInOrg(
    organizationId: number,
    userIds: number[],
  ): Promise<Map<number, MembershipRole>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
          inArray(organizationMemberships.userId, userIds),
        ),
      );
    return new Map(rows.map((row) => [row.userId, row.role]));
  }
}

export const membershipRepository = new MembershipRepository();
