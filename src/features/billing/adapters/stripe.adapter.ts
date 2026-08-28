import Stripe from 'stripe';
import { env } from '../../../app/config';
import { logger } from '../../../shared/logger';
import { BadRequestError } from '../../../shared/errors';
import type { BillingCycle, PlanType } from '../dto/billing.dto';

/**
 * F9 §08 abstract adapter wrapping the Stripe SDK. Every external Stripe
 * call flows through this seam so the domain services never touch the SDK
 * directly (DIP). Keys originate exclusively from `.env`; when unset the
 * adapter fails with a user-safe error instead of booting with fake keys.
 *
 * Logging contract: Stripe errors are logged via Pino with all card and
 * PII fields redacted; raw request bodies, auth headers and tokens are
 * never logged (invariant 13).
 */
/**
 * This Stripe SDK version omits `payment_intent` from the typed Invoice
 * object, so the expanded runtime shape is narrowed with a type predicate
 * guard at the SDK boundary instead of a forced compile-time cast.
 */
interface ExpandedInvoiceShape {
  id: string;
  payment_intent?: { client_secret: string | null } | string | null;
}

function isExpandedInvoiceShape(value: unknown): value is ExpandedInvoiceShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string';
}

export class StripeAdapter {
  private client: Stripe | null = null;

  private getClient(): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
      throw new BadRequestError('Payment processing is not configured yet. Please try again later.');
    }
    if (!this.client) {
      this.client = new Stripe(env.STRIPE_SECRET_KEY);
    }
    return this.client;
  }

  /** Resolves the Stripe price ID for a plan tier and billing cycle. */
  getPriceId(planType: Exclude<PlanType, 'free'>, billingCycle: BillingCycle): string {
    const key =
      planType === 'premium'
        ? billingCycle === 'monthly'
          ? 'STRIPE_PRICE_ID_PREMIUM_MONTHLY'
          : 'STRIPE_PRICE_ID_PREMIUM_ANNUAL'
        : planType === 'enterprise'
          ? billingCycle === 'monthly'
            ? 'STRIPE_PRICE_ID_ENTERPRISE_MONTHLY'
            : 'STRIPE_PRICE_ID_ENTERPRISE_ANNUAL'
          : billingCycle === 'monthly'
            ? 'STRIPE_PRICE_ID_STUDENT_MONTHLY'
            : 'STRIPE_PRICE_ID_STUDENT_ANNUAL';
    const priceId = env[key];
    if (!priceId) {
      throw new BadRequestError('Payment processing is not configured for this plan yet.');
    }
    return priceId;
  }

  /** Finds the Stripe customer bound to a user via `metadata.userId`. */
  async getOrCreateCustomer(input: {
    userId: number;
    email: string;
    fullName: string | null;
  }): Promise<Stripe.Customer> {
    const stripe = this.getClient();
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${input.userId}'`,
      limit: 1,
    });
    if (found.data.length > 0) {
      return found.data[0];
    }
    const byEmail = await stripe.customers.list({ email: input.email, limit: 1 });
    if (byEmail.data.length > 0) {
      return byEmail.data[0];
    }
    return stripe.customers.create({
      email: input.email,
      name: input.fullName ?? undefined,
      metadata: { userId: String(input.userId) },
    });
  }

  /**
   * Creates a Stripe subscription and returns the PaymentIntent client
   * secret (when a payment method is not yet attached) plus the Stripe
   * subscription id.
   */
  async createSubscription(input: {
    customerId: string;
    priceId: string;
    userId: number;
    paymentMethodId?: string | null;
    metadata: Record<string, string>;
  }): Promise<{ stripeSubscriptionId: string; clientSecret: string | null }> {
    const stripe = this.getClient();
    const subscription = await stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      ...(input.paymentMethodId ? { default_payment_method: input.paymentMethodId } : {}),
      metadata: { userId: String(input.userId), ...input.metadata },
    });
    const latestInvoice = subscription.latest_invoice;
    const paymentIntent = isExpandedInvoiceShape(latestInvoice) ? latestInvoice.payment_intent : null;
    const clientSecret =
      typeof paymentIntent === 'object' && paymentIntent !== null && 'client_secret' in paymentIntent
        ? paymentIntent.client_secret
        : null;
    return { stripeSubscriptionId: subscription.id, clientSecret };
  }

  /** Cancels a Stripe subscription immediately (used after end-of-period). */
  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    const stripe = this.getClient();
    await stripe.subscriptions.cancel(stripeSubscriptionId);
  }

  /** Attaches a tokenized payment method to the Stripe customer. */
  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<void> {
    const stripe = this.getClient();
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  }

  /** Detaches a payment method from its Stripe customer. */
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    const stripe = this.getClient();
    await stripe.paymentMethods.detach(paymentMethodId);
  }

  /** Retrieves the display metadata for a tokenized payment method. */
  async getPaymentMethodDetails(paymentMethodId: string): Promise<{
    brand: string | null;
    last4: string | null;
  }> {
    const stripe = this.getClient();
    const method = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (method.type === 'card') {
      return { brand: method.card?.brand ?? null, last4: method.card?.last4 ?? null };
    }
    return { brand: null, last4: null };
  }

  /** Creates a Stripe Customer Portal session URL. */
  async createPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const stripe = this.getClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  /** Verifies the `Stripe-Signature` header against the raw request body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new BadRequestError('Webhook verification is not configured.');
    }
    const stripe = this.getClient();
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }
}

export const stripeAdapter = new StripeAdapter();

/**
 * Wraps an arbitrary Stripe call so failures are logged once, centrally,
 * with sensitive fields redacted. Callers map the throw to a user-safe
 * response (502/402) and roll back any DB writes in their transaction.
 */
export async function runStripeCall<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    logger.warn({ err: { name: err instanceof Error ? err.name : 'StripeError', message: err instanceof Error ? err.message : 'unknown' }, operation }, 'Stripe API call failed');
    throw err;
  }
}

/**
 * Stripe card-decline detection (BIL-02: 402 Payment Required). The SDK
 * surfaces declines as errors carrying `type === 'StripeCardError'` and a
 * `code` like `card_declined` / `authentication_required`.
 */
export function isCardDeclined(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as { type?: unknown; code?: unknown };
  return (
    candidate.type === 'StripeCardError' &&
    (candidate.code === 'card_declined' || candidate.code === 'authentication_required' || candidate.code === 'expired_card')
  );
}