import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { planService } from '../services/plan.service';
import { subscriptionService } from '../services/subscription.service';
import { billingRepository } from '../repositories/billing.repository';
import { actorFrom, userIdFrom } from './billing-actor';

/**
 * F9 learner subscription endpoints (BIL-01..05). Identity always comes
 * from the session; the org id is resolved server-side and cross-checked
 * against any client-provided organizationId (AC-02/AC-04).
 */
export class SubscriptionController {
  /** BIL-01: static plan catalog with the configured currency. */
  async getCatalog(_req: Request, res: Response): Promise<Response> {
    const catalog = planService.getCatalog();
    return sendSuccess(res, catalog, 'Plan catalog retrieved successfully.');
  }

  /** BIL-02: create a subscription (Stripe first, then atomic DB write). */
  async createSubscription(req: Request, res: Response): Promise<Response> {
    const actor = actorFrom(req);
    const body = req.body as {
      planType: 'premium' | 'enterprise' | 'student';
      billingCycle: 'monthly' | 'annual';
      paymentMethodId?: number;
      couponCode?: string;
      organizationId?: number;
    };
    const result = await subscriptionService.create({
      userId: actor.userId,
      organizationId: body.organizationId ?? null,
      planType: body.planType,
      billingCycle: body.billingCycle,
      paymentMethodId: body.paymentMethodId ?? null,
      couponCode: body.couponCode ?? null,
      currency: (await planService.getCatalog()).currency,
    });
    return sendSuccess(res, result, 'Subscription created successfully.', 201);
  }

  /** BIL-03: current subscription (free plan represented as `null`). */
  async getCurrentSubscription(req: Request, res: Response): Promise<Response> {
    const current = await subscriptionService.getCurrent(userIdFrom(req));
    return sendSuccess(res, current, 'Current subscription retrieved successfully.');
  }

  /** BIL-04: cancel own subscription (access continues until end_date). */
  async cancelSubscription(req: Request, res: Response): Promise<Response> {
    const actor = actorFrom(req);
    const orgId = await billingRepository.getOrgId(actor.userId);
    const result = await subscriptionService.cancel(
      Number(req.params.id),
      actor.userId,
      orgId,
    );
    return sendSuccess(res, result, 'Subscription cancelled successfully.');
  }
}

export const subscriptionController = new SubscriptionController();