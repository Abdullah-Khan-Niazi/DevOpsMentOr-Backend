import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { errorMiddleware } from '../../../src/shared/middleware/error.middleware';
import { AppError, ConflictError, ERROR_CODES } from '../../../src/shared/errors';
import { HTTP_STATUS } from '../../../src/shared/constants';

function mockResponse() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const req = { path: '/x', method: 'POST' } as Request;
const next = vi.fn() as unknown as NextFunction;

describe('errorMiddleware Retry-After', () => {
  it('sets Retry-After from errors[0].retryAfterSeconds and keeps the body', () => {
    const res = mockResponse();
    const err = new AppError('Too many requests.', HTTP_STATUS.TOO_MANY_REQUESTS, [
      { code: ERROR_CODES.QUIZ_COOLDOWN, retryAfterSeconds: 90 },
    ]);

    errorMiddleware(err, req, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '90');
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Too many requests.',
      errors: [{ code: ERROR_CODES.QUIZ_COOLDOWN, retryAfterSeconds: 90 }],
    });
  });

  it('rounds fractional seconds up and never emits a negative value', () => {
    const fractional = mockResponse();
    errorMiddleware(
      new AppError('x', HTTP_STATUS.TOO_MANY_REQUESTS, [{ code: ERROR_CODES.RATE_LIMITED, retryAfterSeconds: 1.2 }]),
      req,
      fractional as unknown as Response,
      next,
    );
    expect(fractional.setHeader).toHaveBeenCalledWith('Retry-After', '2');

    const negative = mockResponse();
    errorMiddleware(
      new AppError('x', HTTP_STATUS.TOO_MANY_REQUESTS, [{ code: ERROR_CODES.RATE_LIMITED, retryAfterSeconds: -5 }]),
      req,
      negative as unknown as Response,
      next,
    );
    expect(negative.setHeader).toHaveBeenCalledWith('Retry-After', '0');
  });

  it('does not set the header for errors without a numeric retryAfterSeconds', () => {
    for (const err of [
      new ConflictError('Locked.', [{ code: ERROR_CODES.STEP_LOCKED }]),
      new AppError('x', HTTP_STATUS.TOO_MANY_REQUESTS, [{ code: ERROR_CODES.RATE_LIMITED, retryAfterSeconds: '5' }]),
      new AppError('x', HTTP_STATUS.TOO_MANY_REQUESTS, ['plain string']),
      new AppError('x', HTTP_STATUS.TOO_MANY_REQUESTS),
    ]) {
      const res = mockResponse();
      errorMiddleware(err, req, res as unknown as Response, next);
      expect(res.setHeader).not.toHaveBeenCalled();
    }
  });

  it('keeps the coded error as errors[0] on domain errors', () => {
    const res = mockResponse();
    errorMiddleware(
      new ConflictError('Complete the current step first.', [{ code: ERROR_CODES.STEP_LOCKED }]),
      req,
      res as unknown as Response,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.CONFLICT);
    expect(res.json.mock.calls[0][0].errors[0].code).toBe('STEP_LOCKED');
  });

  it('still maps ZodError to 422 without Retry-After', () => {
    const res = mockResponse();
    const parsed = z.object({ a: z.string() }).safeParse({});
    if (parsed.success) throw new Error('expected failure');

    errorMiddleware(parsed.error, req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

describe('ERROR_CODES', () => {
  it('maps every code to itself', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
