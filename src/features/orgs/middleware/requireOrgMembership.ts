import type { NextFunction, Request, Response } from 'express';
import { ROLES } from '../../../shared/constants';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { classRepository } from '../repositories/class.repository';
import { orgRepository, orgScopeRepository } from '../repositories/org.repository';
import { teamMemberRepository } from '../repositories/team-member.repository';

/** Platform admins operate across all organizations. */
function isPlatformAdmin(req: Request): boolean {
  return req.user?.roles?.includes(ROLES.PLATFORM_ADMIN) ?? false;
}

function hasOrgRole(req: Request): boolean {
  const roles = new Set(req.user?.roles ?? []);
  return (
    roles.has(ROLES.ORG_ADMIN) ||
    roles.has(ROLES.PROFESSOR) ||
    roles.has(ROLES.ORG_STUDENT)
  );
}

function hasStaffRole(req: Request): boolean {
  const roles = new Set(req.user?.roles ?? []);
  return roles.has(ROLES.ORG_ADMIN) || roles.has(ROLES.PROFESSOR);
}

/**
 * F3 org/class membership guards (§06 Forward Integration Hooks).
 *
 * Identity and org scope are NEVER taken from the client; the caller's org
 * is resolved from `user_settings.org_id` for the JWT user. `requireOrgMembership`
 * returns 403 when the caller has no org affiliation (or no organization-scoped
 * role), `requireOrgStaff` additionally requires faculty/admin capability, and
 * `requireClassMembership` verifies an actual roster/ownership relationship.
 */
export function requireOrgMembership() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = Number(req.user?.sub);
      const orgId = await orgScopeRepository.getOrgId(userId);
      if (!orgId) {
        next(new ForbiddenError('You are not a member of any organization.'));
        return;
      }
      // A stale scope pointer must never authorize access to a deleted org.
      if (!(await orgRepository.findById(orgId))) {
        next(new ForbiddenError('Your organization no longer exists.'));
        return;
      }
      if (!hasOrgRole(req) && !isPlatformAdmin(req)) {
        next(new ForbiddenError('You do not hold an organization-scoped role.'));
        return;
      }
      (req as Request & { orgId?: number }).orgId = orgId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Org administration/faculty guard. Students are never staff. */
export function requireOrgStaff() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = Number(req.user?.sub);
      const orgId = await orgScopeRepository.getOrgId(userId);
      if (!orgId) {
        next(new ForbiddenError('You are not a member of any organization.'));
        return;
      }
      if (!(await orgRepository.findById(orgId))) {
        next(new ForbiddenError('Your organization no longer exists.'));
        return;
      }
      if (!hasStaffRole(req) && !isPlatformAdmin(req)) {
        next(new ForbiddenError('You do not have staff access to this organization.'));
        return;
      }
      (req as Request & { orgId?: number }).orgId = orgId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Factory required by the F3 contract: `requireClassMembership(classId)`. */
export function requireClassMembership(classId: number) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = Number(req.user?.sub);
      const permitted = await isClassMember(req, userId, classId);
      next(permitted ? undefined : new ForbiddenError('You do not have access to this class.'));
    } catch (err) {
      next(err);
    }
  };
}

/** Reads `:classId` from validated route params and applies the membership guard. */
export function requireClassMembershipFromParams() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = Number(req.params.classId);
      const userId = Number(req.user?.sub);
      const permitted = await isClassMember(req, userId, classId);
      next(permitted ? undefined : new ForbiddenError('You do not have access to this class.'));
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Staff-only class guard. A professor may only manage classes they own or
 * captain; an org admin may manage classes within their own org. Merely
 * sharing an organization is not sufficient for student/roster access.
 */
export function requireClassStaffFromParams() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = Number(req.params.classId);
      const userId = Number(req.user?.sub);
      const permitted = await isClassStaff(req, userId, classId);
      next(permitted ? undefined : new ForbiddenError('You do not have staff access to this class.'));
    } catch (err) {
      next(err);
    }
  };
}

async function isClassMember(req: Request, userId: number, classId: number): Promise<boolean> {
  const cls = await classRepository.findById(classId);
  if (!cls) {
    throw new NotFoundError('Class not found.');
  }
  if (isPlatformAdmin(req)) {
    return true;
  }
  const scopedOrgId = await orgScopeRepository.getOrgId(userId);

  // Only an org admin scoped to the class's org gets broad org visibility.
  if (
    req.user?.roles?.includes(ROLES.ORG_ADMIN) &&
    scopedOrgId !== null &&
    cls.organizationId !== null &&
    scopedOrgId === cls.organizationId
  ) {
    return true;
  }

  if (await teamMemberRepository.isActiveMember(classId, userId)) {
    return true;
  }
  if (await teamMemberRepository.isProfessorOf(classId, userId)) {
    return true;
  }
  return typeof cls.teamOwnerId === 'number' && cls.teamOwnerId === userId;
}

async function isClassStaff(req: Request, userId: number, classId: number): Promise<boolean> {
  const cls = await classRepository.findById(classId);
  if (!cls) {
    throw new NotFoundError('Class not found.');
  }
  if (isPlatformAdmin(req)) {
    return true;
  }
  if (typeof cls.teamOwnerId === 'number' && cls.teamOwnerId === userId) {
    return true;
  }
  if (await teamMemberRepository.isProfessorOf(classId, userId)) {
    return true;
  }
  if (!req.user?.roles?.includes(ROLES.ORG_ADMIN)) {
    return false;
  }
  const scopedOrgId = await orgScopeRepository.getOrgId(userId);
  return (
    scopedOrgId !== null &&
    cls.organizationId !== null &&
    scopedOrgId === cls.organizationId
  );
}
