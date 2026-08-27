import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { couponService } from '../services/coupon.service';

/** F9 learner coupon endpoints (BIL-05). */
export class CouponController {
  /** BIL-05: validate a coupon and preview the discounted price. */
  async validate(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      code: string;
      planType: 'premium' | 'enterprise' | 'student';
      billingCycle: 'monthly' | 'annual';
    };
    const result = await couponService.validate(body.code, body.planType, body.billingCycle);
    return sendSuccess(res, result, 'Coupon validated successfully.');
  }
}

export const couponController = new CouponController();