import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors';
import { authenticate } from './authenticate.middleware';

/**
 * Identity-attachment middleware for public surfaces (e.g. `GET /users/:userId`).
 *
 * Runs the standard `authenticate` pipeline but treats an absent or invalid
 * token as an anonymous request instead of a 401. Server-side failures are
 * never swallowed. Assumes `req.user` is unset afterwards — consumers must
 * handle the anonymous case.
 */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, (err: unknown) => {
    if (err instanceof UnauthorizedError) {
      next();
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}