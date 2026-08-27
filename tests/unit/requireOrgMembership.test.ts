import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ROLES } from '../../src/shared/constants';
import { ForbiddenError, NotFoundError } from '../../src/shared/errors';

class ClassRow {
  teamId = 10;
  organizationId = 1;
  teamName = 'DevOps 101';
  slug = 'devops-101';
  description: string | null = null;
  teamOwnerId = 3;
  maxMembers = 50;
  isPublic = false;
  createdAt = new Date();
  studentCount = 0;
}

const { classRepositoryMock, orgScopeRepositoryMock, teamMemberRepositoryMock } = vi.hoisted(() => ({
  classRepositoryMock: { findById: vi.fn() },
  orgScopeRepositoryMock: { getOrgId: vi.fn() },
  teamMemberRepositoryMock: { isProfessorOf: vi.fn() },
}));

vi.mock('../../src/features/orgs/repositories/class.repository', () => ({
  classRepository: classRepositoryMock,
  PROFESSOR_ROLES: ['captain', 'co_captain'],
}));
vi.mock('../../src/features/orgs/repositories/org.repository', () => ({
  orgScopeRepository: orgScopeRepositoryMock,
}));
vi.mock('../../src/features/orgs/repositories/team-member.repository', () => ({
  teamMemberRepository: teamMemberRepositoryMock,
}));

import {
  requireClassMembership,
  requireClassMembershipFromParams,
  requireOrgMembership,
} from '../../src/features/orgs/middleware/requireOrgMembership';

function makeReq(overrides: { sub?: string | number; roles?: string[]; params?: Record<string, string> } = {}): Request {
  return {
    user: { sub: String(overrides.sub ?? '9'), roles: overrides.roles ?? [] },
    params: overrides.params ?? {},
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

async function run(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  req: Request,
): Promise<{ error?: unknown }> {
  let error: unknown;
  const next = vi.fn((err?: unknown) => {
    error = err;
  });
  await middleware(req, makeRes(), next);
  return { error };
}

describe('OrgMembershipGuard (F3 security/RBAC)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    classRepositoryMock.findById.mockReset();
    orgScopeRepositoryMock.getOrgId.mockReset();
    teamMemberRepositoryMock.isProfessorOf.mockReset();
  });

  describe('requireOrgMembership (AC-08)', () => {
    it('resolves the caller org from scope and attaches req.orgId', async () => {
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(5);
      const req = makeReq({ sub: 9 });
      const { error } = await run(requireOrgMembership(), req);
      expect(error).toBeUndefined();
      expect((req as Request & { orgId?: number }).orgId).toBe(5);
    });

    it('rejects with 403 when the user has no org affiliation', async () => {
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(null);
      const { error } = await run(requireOrgMembership(), makeReq());
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).statusCode).toBe(403);
    });

    it('propagates repository failures', async () => {
      orgScopeRepositoryMock.getOrgId.mockRejectedValue(new Error('db down'));
      const { error } = await run(requireOrgMembership(), makeReq());
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('db down');
    });
  });

  describe('requireClassMembership classId guard (AC-08, AC-09)', () => {
    function clsWith(organizationId: number): ClassRow {
      const row = new ClassRow();
      row.organizationId = organizationId;
      return row;
    }

    it('allows a platform admin regardless of org membership (AC-11)', async () => {
      classRepositoryMock.findById.mockResolvedValue(clsWith(1));
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(null);
      const { error } = await run(requireClassMembership(10), makeReq({ roles: [ROLES.PLATFORM_ADMIN] }));
      expect(error).toBeUndefined();
    });

    it('allows a member of the class organization', async () => {
      classRepositoryMock.findById.mockResolvedValue(clsWith(1));
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(1);
      const { error } = await run(requireClassMembership(10), makeReq({ sub: 3 }));
      expect(error).toBeUndefined();
      expect(teamMemberRepositoryMock.isProfessorOf).not.toHaveBeenCalled();
    });

    it('rejects an org admin of organization A accessing a class of organization B (AC-08)', async () => {
      classRepositoryMock.findById.mockResolvedValue(clsWith(1));
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(2);
      teamMemberRepositoryMock.isProfessorOf.mockResolvedValue(false);
      const { error } = await run(requireClassMembership(10), makeReq({ sub: 50 }));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).statusCode).toBe(403);
    });

    it('rejects a member of another class within the same org who is not a professor (AC-09/IDOR)', async () => {
      classRepositoryMock.findById.mockResolvedValue(clsWith(1));
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(null);
      teamMemberRepositoryMock.isProfessorOf.mockResolvedValue(false);
      const { error } = await run(requireClassMembership(10), makeReq({ sub: 5 }));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).statusCode).toBe(403);
    });

    it('allows the assigned professor (captain/co_captain) without org scope', async () => {
      classRepositoryMock.findById.mockResolvedValue(clsWith(1));
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(null);
      teamMemberRepositoryMock.isProfessorOf.mockResolvedValue(true);
      const { error } = await run(requireClassMembership(10), makeReq({ sub: 3 }));
      expect(error).toBeUndefined();
      expect(teamMemberRepositoryMock.isProfessorOf).toHaveBeenCalledWith(10, 3);
    });

    it('returns 404 when the class does not exist', async () => {
      classRepositoryMock.findById.mockResolvedValue(null);
      const { error } = await run(requireClassMembership(999), makeReq());
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).statusCode).toBe(404);
    });
  });

  describe('requireClassMembershipFromParams', () => {
    it('derives classId from validated route params', async () => {
      classRepositoryMock.findById.mockResolvedValue(new ClassRow());
      orgScopeRepositoryMock.getOrgId.mockResolvedValue(1);
      const req = makeReq({ sub: 3, params: { classId: '10' } });
      const { error } = await run(requireClassMembershipFromParams(), req);
      expect(error).toBeUndefined();
      expect(classRepositoryMock.findById).toHaveBeenCalledWith(10);
    });
  });
});
