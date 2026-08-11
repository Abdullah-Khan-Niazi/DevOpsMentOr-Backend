import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../../app/database';
import { teamInvitations, teams } from '../../../app/database/schema';
import { ORG_CONSTANTS } from '../../../shared/constants';
import { getSkipTake } from '../../../shared/utils';
import type { InvitationDto } from '../dto/org.dto';

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface InvitationRow {
  invitationId: number;
  teamId: number;
  inviterId: number;
  inviteeEmail: string;
  inviteeUserId: number | null;
  token: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
}

export interface InvitationPage {
  data: InvitationDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface IInvitationRepository {
  ensureSentinelTeam(): Promise<number>;
  findByToken(token: string): Promise<InvitationRow | null>;
  findPendingByClassAndEmail(classId: number, email: string): Promise<InvitationRow | null>;
  insertMany(
    rows: Array<{
      teamId: number;
      inviterId: number;
      inviteeEmail: string;
      token: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  markAccepted(invitationId: number, userId: number): Promise<void>;
  listByClass(classId: number, page: number, pageSize: number): Promise<InvitationPage>;
}

export class InvitationRepository implements IInvitationRepository {
  /** Sentinel team that anchors org-level professor invites (NULL org → never listed). */
  async ensureSentinelTeam(): Promise<number> {
    const existing = await db
      .select({ teamId: teams.teamId, teamOwnerId: teams.teamOwnerId })
      .from(teams)
      .where(eq(teams.slug, ORG_CONSTANTS.ORG_INVITE_SENTINEL_SLUG))
      .limit(1);
    if (existing[0]) {
      return existing[0].teamId;
    }
    throw new Error('Org invite sentinel team is missing; seed the F3 sentinel team.');
  }

  async findByToken(token: string): Promise<InvitationRow | null> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.token, token))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPendingByClassAndEmail(classId: number, email: string): Promise<InvitationRow | null> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(and(
        eq(teamInvitations.teamId, classId),
        eq(teamInvitations.inviteeEmail, email),
        eq(teamInvitations.status, 'pending'),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertMany(
    rows: Array<{
      teamId: number;
      inviterId: number;
      inviteeEmail: string;
      token: string;
      expiresAt: Date;
    }>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await db.insert(teamInvitations).values(rows);
  }

  async markAccepted(invitationId: number, userId: number): Promise<void> {
    await db
      .update(teamInvitations)
      .set({ status: 'accepted', inviteeUserId: userId, acceptedAt: new Date() })
      .where(eq(teamInvitations.invitationId, invitationId));
  }

  async listByClass(classId: number, page: number, pageSize: number): Promise<InvitationPage> {
    const totalRows = await db
      .select({ value: count() })
      .from(teamInvitations)
      .where(eq(teamInvitations.teamId, classId));
    const total = totalRows[0]?.value ?? 0;
    const { skip, take } = getSkipTake(page, pageSize);

    const rows = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.teamId, classId))
      .orderBy(desc(teamInvitations.createdAt))
      .limit(take)
      .offset(skip);

    return {
      data: rows.map((row) => ({
        invitationId: row.invitationId,
        inviteeEmail: row.inviteeEmail,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

export const invitationRepository = new InvitationRepository();

/** Typed helper: org-level professor invites live on the sentinel team. */
export async function findSentinelTeamId(): Promise<number> {
  return invitationRepository.ensureSentinelTeam();
}