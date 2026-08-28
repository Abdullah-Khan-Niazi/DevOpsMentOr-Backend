import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { adminBillingService } from '../services/admin-billing.service';
import { actorFrom } from './billing-actor';

/** F9 platform-admin billing endpoints (BIL-15..18, BIL-22). */
export class AdminBillingController {
  /** BIL-15: paginated subscriptions with search + plan filter. */
  async listSubscriptions(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as {
      page: number;
      limit: number;
      search?: string;
      planType?: 'free' | 'premium' | 'enterprise' | 'student';
    };
    const result = await adminBillingService.listSubscriptions(
      query.page,
      query.limit,
      query.search,
      query.planType,
    );
    return sendSuccess(res, result, 'Subscriptions retrieved successfully.');
  }

  /** BIL-16: adjust a subscription (plan / auto-renew / status). */
  async adjustSubscription(req: Request, res: Response): Promise<Response> {
    const actor = actorFrom(req);
    const body = req.body as {
      planType?: 'free' | 'premium' | 'enterprise' | 'student';
      autoRenew?: boolean;
      isActive?: boolean;
      endDate?: string;
    };
    const result = await adminBillingService.adjustSubscription(Number(req.params.id), actor, body);
    return sendSuccess(res, result, 'Subscription updated successfully.');
  }

  /** BIL-17: paginated orders with search + status filter. */
  async listOrders(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as {
      page: number;
      limit: number;
      search?: string;
      status?: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
    };
    const result = await adminBillingService.listOrders(query.page, query.limit, query.search, query.status);
    return sendSuccess(res, result, 'Orders retrieved successfully.');
  }

  /** BIL-18: flag a paid order for refund. */
  async flagRefund(req: Request, res: Response): Promise<Response> {
    await adminBillingService.flagRefund(Number(req.params.id), actorFrom(req));
    return sendSuccess(res, null, 'Order flagged for refund.');
  }

  /** BIL-22: aggregate billing overview metrics. */
  async getOverview(_req: Request, res: Response): Promise<Response> {
    const overview = await adminBillingService.getOverview();
    return sendSuccess(res, overview, 'Billing overview retrieved successfully.');
  }
}

export const adminBillingController = new AdminBillingController();