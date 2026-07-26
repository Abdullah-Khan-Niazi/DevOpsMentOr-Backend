import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';

export function notFoundMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('Route not found.'));
}
