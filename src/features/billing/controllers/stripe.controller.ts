import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { stripeWebhookService } from '../services/stripe-webhook.service';
import { stripePortalService } from '../services/stripe-portal.service';
import { userIdFrom } from './billing-actor';

/** F9 Stripe integration endpoints (BIL-13/14). */
export class StripeWebhookController {
  /** BIL-13: raw-body webhook ingestion (signature verified per request). */
  async handle(req: Request, res: Response): Promise<Response> {
    const signature = req.get('stripe-signature') ?? '';
    const result = await stripeWebhookService.handle(req.body as Buffer, signature);
    return sendSuccess(res, result, 'Webhook received.');
  }
}

export class StripePortalController {
  /** BIL-14: Stripe Customer Portal session for self-service management. */
  async createSession(req: Request, res: Response): Promise<Response> {
    const session = await stripePortalService.createSession(userIdFrom(req));
    return sendSuccess(res, session, 'Portal session created successfully.');
  }
}

export const stripeWebhookController = new StripeWebhookController();
export const stripePortalController = new StripePortalController();