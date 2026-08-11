import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';

export function authorizeRoles(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      throw new ForbiddenError('Insufficient role privileges.');
    }

    next();
  };
}

export function authorizePermissions(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const hasPermission = requiredPermissions.every((permission) =>
      req.user?.permissions.includes(permission),
    );

    if (!hasPermission) {
      throw new ForbiddenError('Insufficient permissions.');
    }

    next();
  };
}

/** Grants access if the caller holds AT LEAST ONE of the given permissions
 * (OR semantics). Used where two roles reach the same action via different
 * permissions, e.g. F3 class creation by org admin or professor. */
export function authorizeAnyPermissions(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const hasAny = requiredPermissions.some((permission) =>
      req.user?.permissions.includes(permission),
    );

    if (!hasAny) {
      throw new ForbiddenError('Insufficient permissions.');
    }

    next();
  };
}
