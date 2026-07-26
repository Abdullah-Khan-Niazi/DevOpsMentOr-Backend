import type { Response } from 'express';
import type { ApiFailureResponse, ApiSuccessResponse } from '../types';
import { HTTP_STATUS, type HttpStatusCode } from '../constants';

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success.',
  statusCode: HttpStatusCode = HTTP_STATUS.OK,
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    message,
    data,
  };
  return res.status(statusCode).json(body);
}

export function sendFailure(
  res: Response,
  message: string,
  statusCode: HttpStatusCode = HTTP_STATUS.BAD_REQUEST,
  errors: unknown[] = [],
): Response {
  const body: ApiFailureResponse = {
    success: false,
    message,
    errors,
  };
  return res.status(statusCode).json(body);
}
