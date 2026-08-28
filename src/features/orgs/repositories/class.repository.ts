import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../../app/database';
import { teamMembers, teams, users } from '../../../app/database/schema';
import { getSkipTake } from '../../../shared/utils';
import type { ClassDto } from '../dto/org.dto';

export const PROFESSOR_ROLES = ['captain', 'co_captain'] as const;
export type ProfessorRole = (typeof PROFESSOR_ROLES)[number];

export interface ClassRow {
  teamId: number;
  organizationId: number | null;
  teamName: string;
  slug: string;
  description: string | null;
  teamOwnerId: number;
  maxMembers: number;
  createdAt: Date;
}

export interface ClassWithCounts extends ClassRow {
  studentCount: number;
}

export interface ClassPage {
  data: ClassDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface IClassRepository {
  create(input: {
    organizationId: number;
    teamName: string;
    slug: string;
    description: string | null;
    teamOwnerId: number;
    maxMembers: number;
  }): Promise<number>;
  findBySlug(slug: string): Promise<ClassRow | null>;
  findById(classId: number): Promise<ClassWithCounts | null>;
  findOwnerOrg(classId: number): Promise<{ organizationId: number | null } | null>;
  listByOrg(orgId: number, page: number, pageSize: number): Promise<ClassPage>;
  update(
    classId: number,
    fields: { className?: string; description?: string | null; maxMembers?: number },
  ): Promise<void>;
  setOwner(classId: number, ownerUserId: number): Promise<void>;
  countByOrg(orgId: number): Promise<number>;
  findProfessorCount(orgId: number): Promise<number>;
}

function toClassDto(row: ClassRow, studentCount: number, professorName: string | null): ClassDto {
  return {
    classId: row.teamId,
    organizationId: row.organizationId ?? 0,
    className: row.teamName,
    slug: row.slug,
    description: row.description,
    professorUserId: row.teamOwnerId,
    professorName,
    maxStudents: row.maxMembers,
    studentCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export class ClassRepository implements IClassRepository {
  async create(input: {
    organizationId: number;
    teamName: string;
    slug: string;
    description: string | null;
    teamOwnerId: number;
    maxMembers: number;
  }): Promise<number> {
    const inserted = await db.insert(teams).values({
      organizationId: input.organizationId,
      teamName: input.teamName,
      slug: input.slug,
      description: input.description,
      teamOwnerId: input.teamOwnerId,
      isPublic: false,
      maxMembers: input.maxMembers,
    });
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create class.');
    }
    return id;
  }

  async findBySlug(slug: string): Promise<ClassRow | null> {
    const rows = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async findById(classId: number): Promise<ClassWithCounts | null> {
    const rows = await db.select().from(teams).where(eq(teams.teamId, classId)).limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const studentCount = await this.countStudents(classId);
    return { ...row, studentCount };
  }

  async findOwnerOrg(classId: number): Promise<{ organizationId: number | null } | null> {
    const rows = await db
      .select({ organizationId: teams.organizationId })
      .from(teams)
      .where(eq(teams.teamId, classId))
      .limit(1);
    return rows[0] ?? null;
  }

  async countStudents(classId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.teamId, classId),
        eq(teamMembers.role, 'member'),
        eq(teamMembers.isActive, true),
      ));
    return rows[0]?.value ?? 0;
  }

  async listByOrg(orgId: number, page: number, pageSize: number): Promise<ClassPage> {
    const filters = [eq(teams.organizationId, orgId)];

    const totalRows = await db.select({ value: count() }).from(teams).where(and(...filters));
    const total = totalRows[0]?.value ?? 0;
    const { skip, take } = getSkipTake(page, pageSize);

    const rows = await db
      .select({ row: teams, professorName: users.fullName })
      .from(teams)
      .leftJoin(users, eq(users.userId, teams.teamOwnerId))
      .where(and(...filters))
      .orderBy(desc(teams.createdAt))
      .limit(take)
      .offset(skip);

    const data: ClassDto[] = [];
    for (const entry of rows) {
      data.push(toClassDto(entry.row, await this.countStudents(entry.row.teamId), entry.professorName));
    }

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async update(
    classId: number,
    fields: { className?: string; description?: string | null; maxMembers?: number },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (fields.className !== undefined) patch.teamName = fields.className;
    if ('description' in fields) patch.description = fields.description;
    if (fields.maxMembers !== undefined) patch.maxMembers = fields.maxMembers;
    await db.update(teams).set(patch).where(eq(teams.teamId, classId));
  }

  async setOwner(classId: number, ownerUserId: number): Promise<void> {
    await db.update(teams).set({ teamOwnerId: ownerUserId }).where(eq(teams.teamId, classId));
  }

  async countByOrg(orgId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teams)
      .where(and(eq(teams.organizationId, orgId)));
    return rows[0]?.value ?? 0;
  }

  async findProfessorCount(orgId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
      .where(and(
        eq(teams.organizationId, orgId),
        inArray(teamMembers.role, [...PROFESSOR_ROLES]),
        eq(teamMembers.isActive, true),
      ));
    return rows[0]?.value ?? 0;
  }
}

export const classRepository = new ClassRepository();