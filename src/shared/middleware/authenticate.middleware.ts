import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors';
import { tokenService } from '../services/token.service';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Access token is required.');
  }

  const token = authHeader.slice(7);
  const payload = tokenService.verifyAccessToken(token);
  req.user = payload;
  next();
}
