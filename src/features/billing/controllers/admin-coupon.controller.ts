import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { adminCouponService } from '../services/admin-coupon.service';
import { actorFrom } from './billing-actor';

/** F9 platform-admin coupon endpoints (BIL-19..21). */
export class AdminCouponController {
  /** BIL-19: paginated coupon list with code search. */
  async list(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; limit: number; search?: string };
    const result = await adminCouponService.list(query.page, query.limit, query.search);
    return sendSuccess(res, result, 'Coupons retrieved successfully.');
  }

  /** BIL-20: create a coupon (code normalized to uppercase). */
  async create(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      code: string;
      description?: string;
      discountType: 'percentage' | 'fixed_amount';
      discountValue: number;
      maxUses: number;
      expiresAt: string;
    };
    const coupon = await adminCouponService.create(actorFrom(req), {
      code: body.code,
      description: body.description ?? null,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt,
    });
    return sendSuccess(res, coupon, 'Coupon created successfully.', 201);
  }

  /** BIL-21: update a coupon. */
  async update(req: Request, res: Response): Promise<Response> {
    const body = req.body as {
      description?: string;
      discountType?: 'percentage' | 'fixed_amount';
      discountValue?: number;
      maxUses?: number;
      expiresAt?: string;
      isActive?: boolean;
    };
    const coupon = await adminCouponService.update(Number(req.params.id), actorFrom(req), body);
    return sendSuccess(res, coupon, 'Coupon updated successfully.');
  }
}

export const adminCouponController = new AdminCouponController();