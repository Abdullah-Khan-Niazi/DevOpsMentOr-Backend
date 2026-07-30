import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../../shared/constants';
import { sendSuccess } from '../../../shared/utils';
import { authService } from '../services/auth.service';
import type { RegisterDto } from '../dto/auth.dto';

export class AuthController {
  async register(req: Request, res: Response): Promise<Response> {
    const body = req.body as RegisterDto;

    const result = await authService.register(body);

    return sendSuccess(
      res,
      result,
      'User registered successfully.',
      HTTP_STATUS.CREATED,
    );
  }
}

export const authController = new AuthController();