import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { CourseAccessService } from '../../../src/features/orgs/services/course-access.service';
import type { CourseAccessServiceDeps } from '../../../src/features/orgs/services/course-access.service';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const learner = { userId: 7, ipAddress: null, userAgent: 'vitest', roles: ['org_student'] };

function membership(organizationId: number, isPrimary: boolean) {
  return {
    membershipId: organizationId,
    organizationId,
    userId: learner.userId,
    role: 'org_student' as const,
    status: 'active' as const,
    isPrimary,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    invitedBy: null,
    leftAt: null,
    organizationName: `Org ${organizationId}`,
    organizationSlug: `org-${organizationId}`,
  };
}

function makeDeps(): Mocked<CourseAccessServiceDeps> {
  return {
    assignments: {
      findCourseById: vi.fn(async () => ({
        courseId: 1,
        title: 'Linux Fundamentals',
        slug: 'm01-os-linux-basics',
        isPremium: true,
        isPublished: true,
      })),
      findActiveAssignmentForUser: vi.fn(async () => null),
      hasActiveOrgSubscription: vi.fn(async () => false),
    },
    memberships: {
      listActiveForUser: vi.fn(async () => []),
    },
  } as unknown as Mocked<CourseAccessServiceDeps>;
}

describe('CourseAccessService (chaos sprint)', () => {
  let deps: Mocked<CourseAccessServiceDeps>;
  let service: CourseAccessService;

  beforeEach(() => {
    deps = makeDeps();
    service = new CourseAccessService(deps);
  });

  it('404s for a missing course', async () => {
    deps.assignments.findCourseById.mockResolvedValueOnce(null);
    await expect(service.getCourseAccess(learner, 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows platform admins on any course', async () => {
    const access = await service.getCourseAccess(
      { ...learner, roles: ['platform_admin'] },
      1,
    );
    expect(access).toMatchObject({ canAccess: true, reason: 'platform_admin' });
  });

  it('allows free published courses', async () => {
    deps.assignments.findCourseById.mockResolvedValueOnce({
      courseId: 1,
      title: 'Free Intro',
      slug: 'free-intro',
      isPremium: false,
      isPublished: true,
    });
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: true, reason: 'free' });
  });

  it('denies an unpublished course with a clear message', async () => {
    deps.assignments.findCourseById.mockResolvedValueOnce({
      courseId: 1,
      title: 'Draft',
      slug: 'draft',
      isPremium: true,
      isPublished: false,
    });
    const access = await service.getCourseAccess(learner, 1);
    expect(access.canAccess).toBe(false);
    expect(access.reason).toBe('unpublished');
    expect(access.message).toMatch(/not published/i);
  });

  it('allows a course assigned to an active cohort and returns the assignment', async () => {
    deps.assignments.findActiveAssignmentForUser.mockResolvedValueOnce({
      assignmentId: 55,
      classId: 10,
      className: 'DevOps 101',
      courseId: 1,
      courseTitle: 'Linux Fundamentals',
      courseSlug: 'm01-os-linux-basics',
      courseIsPremium: true,
      assignedAt: new Date(),
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      isMandatory: true,
      assignedBy: 9,
    });
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: true, reason: 'assigned' });
    expect(access.assignment?.classId).toBe(10);
  });

  it('allows a member of an org with an active subscription', async () => {
    deps.memberships.listActiveForUser.mockResolvedValueOnce([membership(1, true)]);
    deps.assignments.hasActiveOrgSubscription.mockResolvedValueOnce(true);
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: true, reason: 'org_subscription' });
    expect(deps.assignments.hasActiveOrgSubscription).toHaveBeenCalledWith(1);
  });

  it('grants access through a non-primary membership with an active org subscription', async () => {
    deps.memberships.listActiveForUser.mockResolvedValueOnce([
      membership(1, true),
      membership(2, false),
    ]);
    deps.assignments.hasActiveOrgSubscription.mockImplementation(
      async (orgId: number) => orgId === 2,
    );
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: true, reason: 'org_subscription' });
    expect(deps.assignments.hasActiveOrgSubscription).toHaveBeenCalledWith(1);
    expect(deps.assignments.hasActiveOrgSubscription).toHaveBeenCalledWith(2);
  });

  it('denies when no active membership org holds a subscription', async () => {
    deps.memberships.listActiveForUser.mockResolvedValueOnce([
      membership(1, true),
      membership(2, false),
    ]);
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: false, reason: 'not_entitled' });
    expect(deps.assignments.hasActiveOrgSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not consult subscriptions when the learner has no active membership', async () => {
    const access = await service.getCourseAccess(learner, 1);
    expect(access).toMatchObject({ canAccess: false, reason: 'not_entitled' });
    expect(deps.assignments.hasActiveOrgSubscription).not.toHaveBeenCalled();
  });

  it('denies with an actionable message when nothing entitles the learner', async () => {
    const access = await service.getCourseAccess(learner, 1);
    expect(access.canAccess).toBe(false);
    expect(access.reason).toBe('not_entitled');
    expect(access.message).toMatch(/ask your professor|upgrade/i);
  });

  it('assertCourseAccess throws ForbiddenError carrying the actionable message', async () => {
    await expect(service.assertCourseAccess(learner, 1)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
