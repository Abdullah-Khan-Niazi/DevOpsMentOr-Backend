import { NotFoundError } from '../../../shared/errors';
import { env } from '../../../app/config';
import type { StripeAdapter } from '../adapters/stripe.adapter';
import { runStripeCall, stripeAdapter } from '../adapters/stripe.adapter';
import type { PortalSessionDto } from '../dto/billing.dto';
import type { BillingRepository } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';

export interface StripePortalServiceDeps {
  repo: Pick<BillingRepository, 'findActiveByUser' | 'getUserIdentity'>;
  stripe: Pick<StripeAdapter, 'getOrCreateCustomer' | 'createPortalSession'>;
}

function defaultDeps(): StripePortalServiceDeps {
  return { repo: billingRepository, stripe: stripeAdapter };
}

/**
 * F9 §08 BIL-14: Stripe Billing Portal session for self-service management
 * (plan changes, payment methods, invoices). Requires an active Stripe-backed
 * subscription; a missing one is a 404, not a crash.
 */
export class StripePortalService {
  constructor(private readonly deps: StripePortalServiceDeps = defaultDeps()) {}

  async createSession(userId: number): Promise<PortalSessionDto> {
    const subscription = await this.deps.repo.findActiveByUser(userId);
    if (!subscription?.stripeSubscriptionId) {
      throw new NotFoundError('No active Stripe subscription to manage.');
    }
    const identity = await this.deps.repo.getUserIdentity(userId);
    if (!identity) {
      throw new NotFoundError('User identity could not be resolved.');
    }
    const customer = await runStripeCall('getOrCreateCustomer', () =>
      this.deps.stripe.getOrCreateCustomer({
        userId,
        email: identity.email,
        fullName: identity.fullName,
      }),
    );
    const url = await runStripeCall('createPortalSession', () =>
      this.deps.stripe.createPortalSession(customer.id, `${env.FRONTEND_URL}/settings/billing`),
    );
    return { url };
  }
}

export const stripePortalService = new StripePortalService();