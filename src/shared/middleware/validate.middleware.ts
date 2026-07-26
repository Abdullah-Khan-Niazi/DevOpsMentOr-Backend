import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

type RequestTarget = 'body' | 'query' | 'params';

export function validateRequest(schema: ZodSchema, target: RequestTarget = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req[target]);
    req[target] = parsed;
    next();
  };
}
