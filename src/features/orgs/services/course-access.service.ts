import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { ROLES } from '../../../shared/constants';
import type { CourseAccessDto, OrgActor } from '../dto/org.dto';
import {
  assignmentRepository,
  type IAssignmentRepository,
} from '../repositories/assignment.repository';
import {
  orgScopeRepository,
  type IOrgScopeRepository,
} from '../repositories/org.repository';

export interface CourseAccessServiceDeps {
  assignments: IAssignmentRepository;
  scopes: IOrgScopeRepository;
}

function defaultDeps(): CourseAccessServiceDeps {
  return {
    assignments: assignmentRepository,
    scopes: orgScopeRepository,
  };
}

/**
 * DataCamp-style access rule:
 *   CanAccess = assigned to an active cohort OR org subscription OR course is free.
 * Platform admins bypass (support access). All other denials carry a specific
 * message with a clear next action.
 */
export class CourseAccessService {
  constructor(private readonly deps: CourseAccessServiceDeps = defaultDeps()) {}

  async getCourseAccess(actor: OrgActor, courseId: number): Promise<CourseAccessDto> {
    const course = await this.deps.assignments.findCourseById(courseId);
    if (!course) {
      throw new NotFoundError('Course not found.');
    }

    const roles = new Set(actor.roles ?? []);
    if (roles.has(ROLES.PLATFORM_ADMIN)) {
      return {
        courseId: course.courseId,
        courseTitle: course.title,
        canAccess: true,
        reason: 'platform_admin',
      };
    }

    if (!course.isPublished) {
      return {
        courseId: course.courseId,
        courseTitle: course.title,
        canAccess: false,
        reason: 'unpublished',
        message: 'This course is not published yet. Check back soon.',
      };
    }

    if (!course.isPremium) {
      return {
        courseId: course.courseId,
        courseTitle: course.title,
        canAccess: true,
        reason: 'free',
      };
    }

    const assignment = await this.deps.assignments.findActiveAssignmentForUser(
      actor.userId,
      courseId,
    );
    if (assignment) {
      return {
        courseId: course.courseId,
        courseTitle: course.title,
        canAccess: true,
        reason: 'assigned',
        assignment: {
          assignmentId: assignment.assignmentId,
          classId: assignment.classId,
          className: assignment.className,
          dueDate: assignment.dueDate ? assignment.dueDate.toISOString() : null,
          isMandatory: assignment.isMandatory,
        },
      };
    }

    const orgId = await this.deps.scopes.getOrgId(actor.userId);
    if (orgId !== null && (await this.deps.assignments.hasActiveOrgSubscription(orgId))) {
      return {
        courseId: course.courseId,
        courseTitle: course.title,
        canAccess: true,
        reason: 'org_subscription',
      };
    }

    return {
      courseId: course.courseId,
      courseTitle: course.title,
      canAccess: false,
      reason: 'not_entitled',
      message:
        'This course is locked. Ask your professor to assign it to your cohort, or upgrade to a plan that includes it.',
    };
  }

  async assertCourseAccess(actor: OrgActor, courseId: number): Promise<CourseAccessDto> {
    const access = await this.getCourseAccess(actor, courseId);
    if (!access.canAccess) {
      throw new ForbiddenError(
        access.message ??
          'You do not have access to this course. Ask your organization admin for access.',
      );
    }
    return access;
  }
}

export const courseAccessService = new CourseAccessService();
