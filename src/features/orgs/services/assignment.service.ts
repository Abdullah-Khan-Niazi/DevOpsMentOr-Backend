import { AUDIT_ACTIONS, ROLES } from '../../../shared/constants';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  AssignmentDeadlineState,
  ClassAssignmentWithStatsDto,
  OrgActor,
  StudentAssignmentDto,
} from '../dto/org.dto';
import {
  assignmentRepository,
  type IAssignmentRepository,
} from '../repositories/assignment.repository';
import { classRepository, type IClassRepository } from '../repositories/class.repository';
import {
  orgScopeRepository,
  type IOrgScopeRepository,
} from '../repositories/org.repository';
import {
  teamMemberRepository,
  type ITeamMemberRepository,
} from '../repositories/team-member.repository';

const DUE_SOON_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Deadline state is computed server-side so every client sees the same truth. */
export function computeDeadlineState(
  dueDate: Date | null,
  progressPercent: number,
  now: Date = new Date(),
): AssignmentDeadlineState {
  if (progressPercent >= 100) {
    return 'completed';
  }
  if (!dueDate) {
    return 'no_deadline';
  }
  if (dueDate.getTime() < now.getTime()) {
    return 'overdue';
  }
  if (dueDate.getTime() - now.getTime() <= DUE_SOON_WINDOW_MS) {
    return 'due_soon';
  }
  return 'on_track';
}

interface AssignmentDtoSource {
  assignmentId: number;
  classId: number;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  courseIsPremium: boolean;
  assignedBy: number;
  assignedAt: Date;
  dueDate: Date | null;
  isMandatory: boolean;
}

function toAssignmentDto(row: AssignmentDtoSource) {
  return {
    assignmentId: row.assignmentId,
    classId: row.classId,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    courseSlug: row.courseSlug,
    courseIsPremium: row.courseIsPremium,
    assignedBy: row.assignedBy,
    assignedAt: row.assignedAt.toISOString(),
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    isMandatory: row.isMandatory,
  };
}

export interface AssignmentServiceDeps {
  assignments: IAssignmentRepository;
  classes: IClassRepository;
  members: ITeamMemberRepository;
  scopes: IOrgScopeRepository;
  audit: typeof auditLogService;
}

function defaultDeps(): AssignmentServiceDeps {
  return {
    assignments: assignmentRepository,
    classes: classRepository,
    members: teamMemberRepository,
    scopes: orgScopeRepository,
    audit: auditLogService,
  };
}

/**
 * Cohort course assignments (DataCamp mechanism). Course-level granularity;
 * deadlines are advisory metadata and never gate content by themselves — the
 * access formula lives in `CourseAccessService`.
 */
export class AssignmentService {
  constructor(private readonly deps: AssignmentServiceDeps = defaultDeps()) {}

  private async assertClassStaff(actor: OrgActor, classId: number) {
    const cls = await this.deps.classes.findById(classId);
    if (!cls) {
      throw new NotFoundError('Class not found.');
    }

    const roles = new Set(actor.roles ?? []);
    if (roles.has(ROLES.PLATFORM_ADMIN)) {
      return cls;
    }
    if (cls.teamOwnerId === actor.userId) {
      return cls;
    }
    if (await this.deps.members.isProfessorOf(classId, actor.userId)) {
      return cls;
    }
    if (roles.has(ROLES.ORG_ADMIN)) {
      const scopedOrgId = await this.deps.scopes.getOrgId(actor.userId);
      if (scopedOrgId !== null && cls.organizationId === scopedOrgId) {
        return cls;
      }
    }

    throw new ForbiddenError('You do not have staff access to this class.');
  }

  async listForClass(
    actor: OrgActor,
    classId: number,
  ): Promise<ClassAssignmentWithStatsDto[]> {
    await this.assertClassStaff(actor, classId);

    const [rows, rosterIds] = await Promise.all([
      this.deps.assignments.listByClass(classId),
      this.deps.assignments.listActiveRosterIds(classId),
    ]);

    const now = new Date();
    const result: ClassAssignmentWithStatsDto[] = [];
    for (const row of rows) {
      const completedCount = await this.deps.assignments.countCompletedAmong(
        rosterIds,
        row.courseId,
      );
      const overdueCount =
        row.dueDate && row.dueDate.getTime() < now.getTime()
          ? Math.max(0, rosterIds.length - completedCount)
          : 0;
      let state: AssignmentDeadlineState = 'no_deadline';
      if (rosterIds.length > 0 && completedCount >= rosterIds.length) {
        state = 'completed';
      } else if (overdueCount > 0) {
        state = 'overdue';
      } else if (row.dueDate) {
        state = computeDeadlineState(row.dueDate, 0, now);
      }
      result.push({
        ...toAssignmentDto(row),
        rosterCount: rosterIds.length,
        completedCount,
        overdueCount,
        state,
      });
    }
    return result;
  }

  async create(
    actor: OrgActor,
    classId: number,
    input: { courseId: number; dueDate?: string | null; isMandatory?: boolean },
  ): Promise<ClassAssignmentWithStatsDto> {
    await this.assertClassStaff(actor, classId);

    const course = await this.deps.assignments.findCourseById(input.courseId);
    if (!course) {
      throw new NotFoundError('Course not found.');
    }
    if (!course.isPublished) {
      throw new BadRequestError(
        'This course is not published yet and cannot be assigned to a cohort.',
      );
    }

    const dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (dueDate && dueDate.getTime() <= Date.now()) {
      throw new BadRequestError('The due date must be in the future.');
    }

    const existing = await this.deps.assignments.findByClassAndCourse(classId, input.courseId);
    if (existing) {
      throw new ConflictError('This course is already assigned to this cohort.');
    }

    let assignmentId: number;
    try {
      assignmentId = await this.deps.assignments.create({
        classId,
        courseId: input.courseId,
        assignedBy: actor.userId,
        dueDate,
        isMandatory: input.isMandatory ?? true,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ER_DUP_ENTRY') {
        throw new ConflictError('This course is already assigned to this cohort.');
      }
      throw error;
    }

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.CREATE_CLASS_ASSIGNMENT,
      targetType: 'class_assignment',
      targetId: assignmentId,
      changes: { classId, courseId: input.courseId, dueDate: input.dueDate ?? null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const created = await this.deps.assignments.findById(assignmentId);
    if (!created) {
      throw new NotFoundError('Assignment was created but could not be reloaded.');
    }
    const rosterIds = await this.deps.assignments.listActiveRosterIds(classId);
    return {
      ...toAssignmentDto(created),
      rosterCount: rosterIds.length,
      completedCount: 0,
      overdueCount: 0,
      state: computeDeadlineState(created.dueDate, 0),
    };
  }

  async update(
    actor: OrgActor,
    classId: number,
    assignmentId: number,
    patch: { dueDate?: string | null; isMandatory?: boolean },
  ): Promise<ClassAssignmentWithStatsDto> {
    await this.assertClassStaff(actor, classId);

    const assignment = await this.deps.assignments.findById(assignmentId);
    if (!assignment || assignment.classId !== classId) {
      throw new NotFoundError('Assignment not found for this cohort.');
    }

    const dueDate =
      patch.dueDate === undefined
        ? undefined
        : patch.dueDate === null
          ? null
          : new Date(patch.dueDate);
    if (dueDate && dueDate.getTime() <= Date.now()) {
      throw new BadRequestError('The due date must be in the future.');
    }

    await this.deps.assignments.update(assignmentId, {
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(patch.isMandatory !== undefined ? { isMandatory: patch.isMandatory } : {}),
    });

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.UPDATE_CLASS_ASSIGNMENT,
      targetType: 'class_assignment',
      targetId: assignmentId,
      changes: { classId, ...patch },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = await this.deps.assignments.findById(assignmentId);
    if (!updated) {
      throw new NotFoundError('Assignment was updated but could not be reloaded.');
    }
    const rosterIds = await this.deps.assignments.listActiveRosterIds(classId);
    const completedCount = await this.deps.assignments.countCompletedAmong(
      rosterIds,
      updated.courseId,
    );
    const overdueCount =
      updated.dueDate && updated.dueDate.getTime() < Date.now()
        ? Math.max(0, rosterIds.length - completedCount)
        : 0;
    return {
      ...toAssignmentDto(updated),
      rosterCount: rosterIds.length,
      completedCount,
      overdueCount,
      state:
        rosterIds.length > 0 && completedCount >= rosterIds.length
          ? 'completed'
          : computeDeadlineState(updated.dueDate, 0),
    };
  }

  async delete(actor: OrgActor, classId: number, assignmentId: number): Promise<void> {
    await this.assertClassStaff(actor, classId);

    const assignment = await this.deps.assignments.findById(assignmentId);
    if (!assignment || assignment.classId !== classId) {
      throw new NotFoundError('Assignment not found for this cohort.');
    }

    await this.deps.assignments.deleteById(assignmentId);

    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.DELETE_CLASS_ASSIGNMENT,
      targetType: 'class_assignment',
      targetId: assignmentId,
      changes: { classId, courseId: assignment.courseId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async listForStudent(userId: number): Promise<StudentAssignmentDto[]> {
    const rows = await this.deps.assignments.listStudentAssignments(userId);
    const progressMap = await this.deps.assignments.getCourseProgressMap(
      userId,
      [...new Set(rows.map((row) => row.courseId))],
    );

    return rows.map((row) => {
      const progressPercent = progressMap.get(row.courseId) ?? 0;
      return {
        ...toAssignmentDto(row),
        className: row.className,
        progressPercent,
        state: computeDeadlineState(row.dueDate, progressPercent),
      };
    });
  }
}

export const assignmentService = new AssignmentService();
