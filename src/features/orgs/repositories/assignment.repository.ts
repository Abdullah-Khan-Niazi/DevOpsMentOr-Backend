import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  classAssignments,
  subscriptions,
  teamMembers,
  teams,
  userProgress,
} from '../../../app/database/schema';

export interface AssignmentCourseRow {
  assignmentId: number;
  classId: number;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  courseIsPremium: boolean;
  courseIsPublished: boolean;
  assignedBy: number;
  assignedAt: Date;
  dueDate: Date | null;
  isMandatory: boolean;
  className: string;
}

export interface CourseAccessRow {
  courseId: number;
  title: string;
  slug: string;
  isPremium: boolean;
  isPublished: boolean;
}

export interface StudentAssignmentRow {
  assignmentId: number;
  classId: number;
  className: string;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  courseIsPremium: boolean;
  assignedAt: Date;
  dueDate: Date | null;
  isMandatory: boolean;
  assignedBy: number;
}

export interface IAssignmentRepository {
  findCourseById(courseId: number): Promise<CourseAccessRow | null>;
  listByClass(classId: number): Promise<AssignmentCourseRow[]>;
  findById(assignmentId: number): Promise<AssignmentCourseRow | null>;
  findByClassAndCourse(classId: number, courseId: number): Promise<AssignmentCourseRow | null>;
  findActiveAssignmentForUser(
    userId: number,
    courseId: number,
  ): Promise<StudentAssignmentRow | null>;
  listStudentAssignments(userId: number): Promise<StudentAssignmentRow[]>;
  getCourseProgressMap(userId: number, courseIds: number[]): Promise<Map<number, number>>;
  listActiveRosterIds(classId: number): Promise<number[]>;
  countCompletedAmong(userIds: number[], courseId: number): Promise<number>;
  hasActiveOrgSubscription(orgId: number): Promise<boolean>;
  create(input: {
    classId: number;
    courseId: number;
    assignedBy: number;
    dueDate: Date | null;
    isMandatory: boolean;
  }): Promise<number>;
  update(
    assignmentId: number,
    patch: { dueDate?: Date | null; isMandatory?: boolean },
  ): Promise<void>;
  deleteById(assignmentId: number): Promise<void>;
}

const assignmentSelection = {
  assignmentId: classAssignments.assignmentId,
  classId: classAssignments.teamId,
  courseId: classAssignments.courseId,
  courseTitle: academyCourses.title,
  courseSlug: academyCourses.slug,
  courseIsPremium: academyCourses.isPremium,
  courseIsPublished: academyCourses.isPublished,
  assignedBy: classAssignments.assignedBy,
  assignedAt: classAssignments.assignedAt,
  dueDate: classAssignments.dueDate,
  isMandatory: classAssignments.isMandatory,
  className: teams.teamName,
};

export class AssignmentRepository implements IAssignmentRepository {
  async findCourseById(courseId: number): Promise<CourseAccessRow | null> {
    const [course] = await db
      .select({
        courseId: academyCourses.courseId,
        title: academyCourses.title,
        slug: academyCourses.slug,
        isPremium: academyCourses.isPremium,
        isPublished: academyCourses.isPublished,
      })
      .from(academyCourses)
      .where(eq(academyCourses.courseId, courseId))
      .limit(1);
    return course ?? null;
  }

  async listByClass(classId: number): Promise<AssignmentCourseRow[]> {
    return db
      .select(assignmentSelection)
      .from(classAssignments)
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .where(eq(classAssignments.teamId, classId))
      .orderBy(desc(classAssignments.assignedAt));
  }

  async findById(assignmentId: number): Promise<AssignmentCourseRow | null> {
    const [row] = await db
      .select(assignmentSelection)
      .from(classAssignments)
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .where(eq(classAssignments.assignmentId, assignmentId))
      .limit(1);
    return row ?? null;
  }

  async findByClassAndCourse(
    classId: number,
    courseId: number,
  ): Promise<AssignmentCourseRow | null> {
    const [row] = await db
      .select(assignmentSelection)
      .from(classAssignments)
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .where(and(eq(classAssignments.teamId, classId), eq(classAssignments.courseId, courseId)))
      .limit(1);
    return row ?? null;
  }

  async findActiveAssignmentForUser(
    userId: number,
    courseId: number,
  ): Promise<StudentAssignmentRow | null> {
    const [row] = await db
      .select({
        assignmentId: classAssignments.assignmentId,
        classId: classAssignments.teamId,
        className: teams.teamName,
        courseId: classAssignments.courseId,
        courseTitle: academyCourses.title,
        courseSlug: academyCourses.slug,
        courseIsPremium: academyCourses.isPremium,
        assignedAt: classAssignments.assignedAt,
        dueDate: classAssignments.dueDate,
        isMandatory: classAssignments.isMandatory,
        assignedBy: classAssignments.assignedBy,
      })
      .from(classAssignments)
      .innerJoin(teamMembers, eq(teamMembers.teamId, classAssignments.teamId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .where(
        and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.isActive, true),
          eq(classAssignments.courseId, courseId),
        ),
      )
      .orderBy(classAssignments.dueDate)
      .limit(1);
    return row ?? null;
  }

  async listStudentAssignments(userId: number): Promise<StudentAssignmentRow[]> {
    return db
      .select({
        assignmentId: classAssignments.assignmentId,
        classId: classAssignments.teamId,
        className: teams.teamName,
        courseId: classAssignments.courseId,
        courseTitle: academyCourses.title,
        courseSlug: academyCourses.slug,
        courseIsPremium: academyCourses.isPremium,
        assignedAt: classAssignments.assignedAt,
        dueDate: classAssignments.dueDate,
        isMandatory: classAssignments.isMandatory,
        assignedBy: classAssignments.assignedBy,
      })
      .from(classAssignments)
      .innerJoin(teamMembers, eq(teamMembers.teamId, classAssignments.teamId))
      .innerJoin(academyCourses, eq(academyCourses.courseId, classAssignments.courseId))
      .innerJoin(teams, eq(teams.teamId, classAssignments.teamId))
      .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isActive, true)))
      .orderBy(classAssignments.dueDate);
  }

  async getCourseProgressMap(
    userId: number,
    courseIds: number[],
  ): Promise<Map<number, number>> {
    if (courseIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .select({
        courseId: userProgress.courseId,
        progressPercentage: userProgress.progressPercentage,
      })
      .from(userProgress)
      .where(
        and(
          eq(userProgress.userId, userId),
          inArray(userProgress.courseId, courseIds),
          isNull(userProgress.lessonId),
          isNull(userProgress.moduleId),
        ),
      );

    const map = new Map<number, number>();
    for (const row of rows) {
      if (row.courseId !== null) {
        const value = Number(row.progressPercentage);
        map.set(row.courseId, Number.isFinite(value) ? value : 0);
      }
    }
    return map;
  }

  async listActiveRosterIds(classId: number): Promise<number[]> {
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, classId), eq(teamMembers.isActive, true)));
    return rows.map((row) => row.userId);
  }

  async countCompletedAmong(userIds: number[], courseId: number): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }

    const [row] = await db
      .select({ completed: sql<number>`COUNT(*)` })
      .from(userProgress)
      .where(
        and(
          inArray(userProgress.userId, userIds),
          eq(userProgress.courseId, courseId),
          isNull(userProgress.lessonId),
          isNull(userProgress.moduleId),
          sql`(${userProgress.isCompleted} = true OR ${userProgress.progressPercentage} >= 100)`,
        ),
      );
    return Number(row?.completed ?? 0);
  }

  async hasActiveOrgSubscription(orgId: number): Promise<boolean> {
    const [row] = await db
      .select({ subscriptionId: subscriptions.subscriptionId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, orgId),
          eq(subscriptions.isActive, true),
          sql`(${subscriptions.endDate} IS NULL OR ${subscriptions.endDate} > NOW())`,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async create(input: {
    classId: number;
    courseId: number;
    assignedBy: number;
    dueDate: Date | null;
    isMandatory: boolean;
  }): Promise<number> {
    const inserted = await db.insert(classAssignments).values({
      teamId: input.classId,
      courseId: input.courseId,
      assignedBy: input.assignedBy,
      dueDate: input.dueDate,
      isMandatory: input.isMandatory,
    });
    const assignmentId = inserted[0]?.insertId;
    if (!assignmentId) {
      throw new Error('Failed to create class assignment.');
    }
    return assignmentId;
  }

  async update(
    assignmentId: number,
    patch: { dueDate?: Date | null; isMandatory?: boolean },
  ): Promise<void> {
    await db
      .update(classAssignments)
      .set({
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.isMandatory !== undefined ? { isMandatory: patch.isMandatory } : {}),
      })
      .where(eq(classAssignments.assignmentId, assignmentId));
  }

  async deleteById(assignmentId: number): Promise<void> {
    await db.delete(classAssignments).where(eq(classAssignments.assignmentId, assignmentId));
  }
}

export const assignmentRepository = new AssignmentRepository();
