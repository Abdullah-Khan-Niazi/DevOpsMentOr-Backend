import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import {
  AssignmentService,
  computeDeadlineState,
} from '../../../src/features/orgs/services/assignment.service';
import type { AssignmentServiceDeps } from '../../../src/features/orgs/services/assignment.service';
import type { AssignmentCourseRow, StudentAssignmentRow } from '../../../src/features/orgs/repositories/assignment.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const actor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest', roles: ['org_admin'] };

function classRow(overrides: Record<string, unknown> = {}) {
  return {
    teamId: 10,
    organizationId: 1,
    teamName: 'DevOps 101',
    slug: 'devops-101',
    description: null,
    teamOwnerId: 3,
    maxMembers: 50,
    studentCount: 0,
    createdAt: new Date('2026-01-05T00:00:00.000Z'),
    ...overrides,
  };
}

function assignmentRow(overrides: Partial<AssignmentCourseRow> = {}): AssignmentCourseRow {
  return {
    assignmentId: 55,
    classId: 10,
    courseId: 1,
    courseTitle: 'Linux Fundamentals',
    courseSlug: 'm01-os-linux-basics',
    courseIsPremium: true,
    courseIsPublished: true,
    assignedBy: 9,
    assignedAt: new Date('2026-02-01T00:00:00.000Z'),
    dueDate: new Date(Date.now() + 5 * 24 * 3600 * 1000),
    isMandatory: true,
    className: 'DevOps 101',
    ...overrides,
  };
}

function studentAssignmentRow(
  overrides: Partial<StudentAssignmentRow> = {},
): StudentAssignmentRow {
  return {
    assignmentId: 55,
    classId: 10,
    className: 'DevOps 101',
    courseId: 1,
    courseTitle: 'Linux Fundamentals',
    courseSlug: 'm01-os-linux-basics',
    courseIsPremium: true,
    assignedAt: new Date('2026-02-01T00:00:00.000Z'),
    // 48h ahead keeps the default fixture inside the due_soon window.
    dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
    isMandatory: true,
    assignedBy: 9,
    ...overrides,
  };
}

function makeDeps(): Mocked<AssignmentServiceDeps> {
  const deps = {
    assignments: {
      findCourseById: vi.fn(async () => ({
        courseId: 1,
        title: 'Linux Fundamentals',
        slug: 'm01-os-linux-basics',
        isPremium: true,
        isPublished: true,
      })),
      listByClass: vi.fn(async () => [assignmentRow()]),
      findById: vi.fn(async () => assignmentRow()),
      findByClassAndCourse: vi.fn(async () => null),
      findActiveAssignmentForUser: vi.fn(async () => studentAssignmentRow()),
      listStudentAssignments: vi.fn(async () => [studentAssignmentRow()]),
      getCourseProgressMap: vi.fn(async () => new Map<number, number>([[1, 40]])),
      listActiveRosterIds: vi.fn(async () => [7, 8]),
      countCompletedAmong: vi.fn(async () => 1),
      hasActiveOrgSubscription: vi.fn(async () => false),
      create: vi.fn(async () => 55),
      update: vi.fn(async () => undefined),
      deleteById: vi.fn(async () => undefined),
    },
    classes: {
      findById: vi.fn(async () => classRow()),
    },
    members: {
      isProfessorOf: vi.fn(async () => false),
    },
    scopes: {
      getOrgId: vi.fn(async () => 1),
    },
    audit: {
      record: vi.fn(async () => undefined),
    },
  };
  return deps as unknown as Mocked<AssignmentServiceDeps>;
}

describe('AssignmentService (chaos sprint)', () => {
  let deps: Mocked<AssignmentServiceDeps>;
  let service: AssignmentService;

  beforeEach(() => {
    deps = makeDeps();
    service = new AssignmentService(deps);
  });

  describe('staff authorization', () => {
    it('allows platform admins', async () => {
      const result = await service.listForClass(
        { ...actor, roles: ['platform_admin'] },
        10,
      );
      expect(result).toHaveLength(1);
    });

    it('allows the class owner', async () => {
      deps.classes.findById.mockResolvedValueOnce(classRow({ teamOwnerId: actor.userId }));
      const result = await service.listForClass({ ...actor, roles: ['professor'] }, 10);
      expect(result).toHaveLength(1);
    });

    it('allows a professor of record even without the owner id', async () => {
      deps.members.isProfessorOf.mockResolvedValueOnce(true);
      await expect(
        service.listForClass({ ...actor, roles: ['professor'] }, 10),
      ).resolves.toHaveLength(1);
    });

    it('allows an org admin whose scope matches the class organization', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(1);
      await expect(service.listForClass(actor, 10)).resolves.toHaveLength(1);
    });

    it('denies an org admin from another organization', async () => {
      deps.scopes.getOrgId.mockResolvedValueOnce(2);
      await expect(service.listForClass(actor, 10)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('denies a student', async () => {
      await expect(
        service.listForClass({ ...actor, roles: ['org_student'] }, 10),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404s for a missing class before any authorization claim', async () => {
      deps.classes.findById.mockResolvedValueOnce(null);
      await expect(service.listForClass(actor, 10)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('create', () => {
    it('rejects a missing course', async () => {
      deps.assignments.findCourseById.mockResolvedValueOnce(null);
      await expect(service.create(actor, 10, { courseId: 99 })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('rejects an unpublished course with an actionable message', async () => {
      deps.assignments.findCourseById.mockResolvedValueOnce({
        courseId: 1,
        title: 'Draft',
        slug: 'draft',
        isPremium: true,
        isPublished: false,
      });
      await expect(service.create(actor, 10, { courseId: 1 })).rejects.toThrow(
        /not published/i,
      );
    });

    it('rejects a due date in the past', async () => {
      await expect(
        service.create(actor, 10, {
          courseId: 1,
          dueDate: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects a duplicate assignment', async () => {
      deps.assignments.findByClassAndCourse.mockResolvedValueOnce(assignmentRow());
      await expect(service.create(actor, 10, { courseId: 1 })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('maps a unique-constraint race to a conflict', async () => {
      deps.assignments.create.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }),
      );
      await expect(service.create(actor, 10, { courseId: 1 })).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('creates, audits, and returns the assignment', async () => {
      const created = await service.create(actor, 10, {
        courseId: 1,
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(created.assignmentId).toBe(55);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_class_assignment', targetId: 55 }),
      );
    });
  });

  describe('update / delete ownership', () => {
    it('404s when the assignment belongs to another class', async () => {
      deps.assignments.findById.mockResolvedValueOnce(assignmentRow({ classId: 99 }));
      await expect(
        service.update(actor, 10, 55, { isMandatory: false }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects a past due date on update', async () => {
      await expect(
        service.update(actor, 10, 55, {
          dueDate: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('audits a successful delete', async () => {
      await service.delete(actor, 10, 55);
      expect(deps.assignments.deleteById).toHaveBeenCalledWith(55);
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_class_assignment', targetId: 55 }),
      );
    });
  });

  describe('student listing', () => {
    it('returns assignments with progress and deadline state', async () => {
      const rows = await service.listForStudent(7);
      expect(rows).toHaveLength(1);
      expect(rows[0].progressPercent).toBe(40);
      expect(rows[0].state).toBe('due_soon');
    });

    it('does not swallow repository errors', async () => {
      deps.assignments.listStudentAssignments.mockRejectedValueOnce(new Error('db down'));
      await expect(service.listForStudent(7)).rejects.toThrow('db down');
    });
  });
});

describe('computeDeadlineState', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  it('marks 100% as completed', () => {
    expect(computeDeadlineState(new Date('2026-05-01T00:00:00.000Z'), 100, now)).toBe(
      'completed',
    );
  });

  it('marks a past due date as overdue', () => {
    expect(computeDeadlineState(new Date('2026-05-31T00:00:00.000Z'), 40, now)).toBe(
      'overdue',
    );
  });

  it('marks a due date within 72h as due_soon', () => {
    expect(computeDeadlineState(new Date('2026-06-02T12:00:00.000Z'), 0, now)).toBe(
      'due_soon',
    );
  });

  it('marks a distant due date as on_track', () => {
    expect(computeDeadlineState(new Date('2026-06-20T00:00:00.000Z'), 0, now)).toBe(
      'on_track',
    );
  });

  it('marks no due date as no_deadline', () => {
    expect(computeDeadlineState(null, 10, now)).toBe('no_deadline');
  });
});
