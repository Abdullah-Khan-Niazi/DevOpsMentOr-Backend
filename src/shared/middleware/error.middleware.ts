import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { HTTP_STATUS } from '../constants';
import { sendFailure } from '../utils';
import { logger } from '../logger';

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  if (err instanceof ZodError) {
    const errors = err.errors.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    logger.warn({ path: _req.path, method: _req.method, errors }, 'Request validation failed');
    const firstMessage = errors[0]?.message;
    const message = firstMessage || 'Validation failed.';
    return sendFailure(res, message, HTTP_STATUS.UNPROCESSABLE_ENTITY, errors);
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational application error');
    }
    return sendFailure(res, err.message, err.statusCode, err.errors);
  }

  logger.error({ err }, 'Unhandled error');
  return sendFailure(
    res,
    'An unexpected error occurred.',
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
  );
}
