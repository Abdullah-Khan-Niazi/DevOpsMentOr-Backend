import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../../app/database';
import { organizations, teamMembers, teams, users } from '../../../app/database/schema';
import { getSkipTake } from '../../../shared/utils';
import { PROFESSOR_ROLES, type ProfessorRole } from './class.repository';

export interface RosterRow {
  userId: number;
  fullName: string | null;
  email: string;
  enrolledAt: Date;
  isActive: boolean;
}

export interface RosterPage {
  data: RosterRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ActiveStudentClassRow {
  teamId: number;
  teamName: string;
  organizationId: number | null;
  organizationName: string;
  joinedAt: Date;
}

export interface ITeamMemberRepository {
  isActiveMember(classId: number, userId: number): Promise<boolean>;
  isProfessorOf(classId: number, userId: number): Promise<boolean>;
  assignedClassIds(orgId: number, userId: number): Promise<number[]>;
  professorUserIds(orgId: number): Promise<number[]>;
  countStudentsByOrg(orgId: number): Promise<number>;
  upsertProfessor(classId: number, userId: number, role: ProfessorRole): Promise<void>;
  deactivateOtherProfessors(classId: number, exceptUserId: number): Promise<void>;
  insertStudent(classId: number, userId: number): Promise<void>;
  withdraw(classId: number, userId: number): Promise<void>;
  roster(classId: number, page: number, pageSize: number, showAll: boolean): Promise<RosterPage>;
  findActiveStudentClass(userId: number, classId?: number): Promise<ActiveStudentClassRow | null>;
  listActiveStudentClasses(userId: number): Promise<ActiveStudentClassRow[]>;
  listActiveStudentIds(classId: number): Promise<number[]>;
  listActiveUserIdsByOrg(orgId: number): Promise<number[]>;
  hasAnyActiveMembership(userId: number): Promise<boolean>;
}

/** Member/enrollment repository: roster, professor checks, withdrawal. */
export class TeamMemberRepository implements ITeamMemberRepository {
  async isActiveMember(classId: number, userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async isProfessorOf(classId: number, userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.userId, userId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** Classes (within a user's org) a user captains; used for professor listing. */
  async assignedClassIds(orgId: number, userId: number): Promise<number[]> {
    const rows = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(
        eq(teams.organizationId, orgId),
        eq(teamMembers.userId, userId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ));
    return rows.map((row) => row.teamId);
  }

  /** Active professor (captain/co_captain) user ids across an org's classes. */
  async professorUserIds(orgId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(
        eq(teams.organizationId, orgId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ));
    return [...new Set(rows.map((row) => row.userId))];
  }

  /** ORG-06 stats: total active students enrolled in an org's classes. */
  async countStudentsByOrg(orgId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(
        eq(teams.organizationId, orgId),
        eq(teamMembers.role, 'member'),
        eq(teamMembers.isActive, true),
      ));
    return rows[0]?.value ?? 0;
  }

  async upsertProfessor(classId: number, userId: number, role: ProfessorRole): Promise<void> {
    const existing = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.userId, userId)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(teamMembers)
        .set({ role, isActive: true, leftAt: null })
        .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.userId, userId)));
      return;
    }

    await db.insert(teamMembers).values({ teamId: classId, userId, role });
  }

  async deactivateOtherProfessors(classId: number, exceptUserId: number): Promise<void> {
    await db
      .update(teamMembers)
      .set({ isActive: false, leftAt: new Date() })
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.isActive, true),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        ne(teamMembers.userId, exceptUserId),
      ));
  }

  async insertStudent(classId: number, userId: number): Promise<void> {
    const existing = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.userId, userId)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(teamMembers)
        .set({ role: 'member', isActive: true, leftAt: null })
        .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.userId, userId)));
      return;
    }

    await db.insert(teamMembers).values({ teamId: classId, userId, role: 'member' });
  }

  async withdraw(classId: number, userId: number): Promise<void> {
    await db
      .update(teamMembers)
      .set({ isActive: false, leftAt: new Date() })
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.userId, userId)));
  }

  async roster(classId: number, page: number, pageSize: number, showAll: boolean): Promise<RosterPage> {
    const filters = [eq(teamMembers.teamId, classId), eq(teamMembers.role, 'member')];
    if (!showAll) {
      filters.push(eq(teamMembers.isActive, true));
    }

    const totalRows = await db.select({ value: count() }).from(teamMembers).where(and(...filters));
    const total = totalRows[0]?.value ?? 0;
    const { skip, take } = getSkipTake(page, pageSize);

    const rows = await db
      .select({
        userId: users.userId,
        fullName: users.fullName,
        email: users.email,
        enrolledAt: teamMembers.joinedAt,
        isActive: teamMembers.isActive,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.userId, teamMembers.userId))
      .where(and(...filters))
      .orderBy(desc(teamMembers.joinedAt))
      .limit(take)
      .offset(skip);

    return { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** ENR-03: one active class enrollment, optionally narrowed to a class. */
  async findActiveStudentClass(
    userId: number,
    classId?: number,
  ): Promise<ActiveStudentClassRow | null> {
    const filters = [
      eq(teamMembers.userId, userId),
      eq(teamMembers.role, 'member'),
      eq(teamMembers.isActive, true),
    ];
    if (classId !== undefined) {
      filters.push(eq(teamMembers.teamId, classId));
    }

    const rows = await db
      .select({
        teamId: teamMembers.teamId,
        teamName: teams.teamName,
        organizationId: teams.organizationId,
        organizationName: organizations.name,
        joinedAt: teamMembers.joinedAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .innerJoin(organizations, eq(organizations.organizationId, teams.organizationId))
      .where(and(...filters))
      .orderBy(desc(teamMembers.joinedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Every active class a learner belongs to (multi-class context). */
  async listActiveStudentClasses(userId: number): Promise<ActiveStudentClassRow[]> {
    return db
      .select({
        teamId: teamMembers.teamId,
        teamName: teams.teamName,
        organizationId: teams.organizationId,
        organizationName: organizations.name,
        joinedAt: teamMembers.joinedAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .innerJoin(organizations, eq(organizations.organizationId, teams.organizationId))
      .where(and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, 'member'),
        eq(teamMembers.isActive, true),
      ))
      .orderBy(desc(teamMembers.joinedAt));
  }

  /** Snapshot before deleting a class: who may lose their last enrollment. */
  async listActiveStudentIds(classId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.role, 'member'),
        eq(teamMembers.isActive, true),
      ));
    return rows.map((row) => row.userId);
  }

  /** Users with any active membership in the organization's classes. */
  async listActiveUserIdsByOrg(orgId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(
        eq(teams.organizationId, orgId),
        eq(teamMembers.isActive, true),
      ));
    return [...new Set(rows.map((row) => row.userId))];
  }

  /** Used after org deletion to decide whether org roles are still meaningful. */
  async hasAnyActiveMembership(userId: number): Promise<boolean> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isActive, true)))
      .limit(1);
    return rows.length > 0;
  }
}

export const teamMemberRepository = new TeamMemberRepository();