import type { NextFunction, Request, Response } from 'express';
import { ROLES } from '../../../shared/constants';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { classRepository } from '../repositories/class.repository';
import { orgScopeRepository } from '../repositories/org.repository';
import { teamMemberRepository } from '../repositories/team-member.repository';

/** Platform admins operate across all organizations. */
function isPlatformAdmin(req: Request): boolean {
  return req.user?.roles?.includes(ROLES.PLATFORM_ADMIN) ?? false;
}

/**
 * F3 org/class membership guards (§06 Forward Integration Hooks).
 *
 * Identity and org scope are NEVER taken from the client; the caller's org
 * is resolved from `user_settings.org_id` for the JWT user. `requireOrgMembership`
 * returns 403 when the caller has no org affiliation; `requireClassMembership`
 * additionally verifies the target class belongs to the caller's org, or the
 * caller is the assigned professor (captain/co_captain), or is a platform admin.
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

/** Reads `:classId` from validated route params and applies the guard. */
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

async function isClassMember(req: Request, userId: number, classId: number): Promise<boolean> {
  if (isPlatformAdmin(req)) {
    return true;
  }
  const cls = await classRepository.findById(classId);
  if (!cls) {
    throw new NotFoundError('Class not found.');
  }
  const orgId = await orgScopeRepository.getOrgId(userId);
  if (orgId !== null && orgId === cls.organizationId) {
    return true;
  }
  return teamMemberRepository.isProfessorOf(classId, userId);
}
