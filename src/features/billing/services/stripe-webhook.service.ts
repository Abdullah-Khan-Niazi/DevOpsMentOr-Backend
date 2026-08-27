import Stripe from 'stripe';
import { BadRequestError } from '../../../shared/errors';
import type { StripeAdapter } from '../adapters/stripe.adapter';
import { stripeAdapter } from '../adapters/stripe.adapter';
import type { BillingRepository } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';
import type { InvoiceService } from './invoice.service';
import { invoiceService } from './invoice.service';
import type { OrderService } from './order.service';
import { orderService } from './order.service';
import type { SubscriptionService } from './subscription.service';
import { subscriptionService } from './subscription.service';

/** Narrow, runtime-guarded view of the Stripe invoice webhook payload. */
interface WebhookInvoiceShape {
  id: string;
  subscription?: string | null;
  payment_intent?: string | null;
  invoice_pdf?: string | null;
  hosted_invoice_url?: string | null;
  period_end?: number;
  customer?: string | null;
}

/** Narrow, runtime-guarded view of the Stripe subscription webhook payload. */
interface WebhookSubscriptionShape {
  id: string;
  metadata?: { userId?: string } | null;
}

function isWebhookInvoice(value: unknown): value is WebhookInvoiceShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string';
}

function isWebhookSubscription(value: unknown): value is WebhookSubscriptionShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string';
}

export interface StripeWebhookServiceDeps {
  stripe: Pick<StripeAdapter, 'verifyWebhookSignature'>;
  repo: Pick<BillingRepository, 'findOrderByStripePaymentIntentId' | 'findOrderByStripeSubscriptionId'>;
  orders: Pick<OrderService, 'markPaid' | 'markFailed'>;
  invoices: Pick<InvoiceService, 'create'>;
  subscriptions: Pick<
    SubscriptionService,
    'renew' | 'markPaymentFailed' | 'markCancelled'
  >;
}

function defaultDeps(): StripeWebhookServiceDeps {
  return {
    stripe: stripeAdapter,
    repo: billingRepository,
    orders: orderService,
    invoices: invoiceService,
    subscriptions: subscriptionService,
  };
}

/**
 * F9 §08 Stripe webhook ingestion (BIL-13). The signature is verified
 * against the raw request buffer on EVERY request before any processing;
 * invalid signatures return 400 and cause zero DB mutations (AC-05/06).
 * Stripe always receives `{ received: true }` after a handled event so
 * retries are not triggered for already-processed events.
 */
export class StripeWebhookService {
  constructor(private readonly deps: StripeWebhookServiceDeps = defaultDeps()) {}

  async handle(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    let event: Stripe.Event;
    try {
      event = this.deps.stripe.verifyWebhookSignature(rawBody, signature);
    } catch {
      throw new BadRequestError('Invalid webhook signature.');
    }
    return this.process(event);
  }

  /** Event-type switch with the DB effects defined in contract §07 (BIL-13). */
  async process(event: Stripe.Event): Promise<{ received: true }> {
    const object = event.data.object;

    switch (event.type) {
      case 'invoice.payment_succeeded':
        if (isWebhookInvoice(object)) {
          await this.onPaymentSucceeded(object);
        }
        break;
      case 'invoice.payment_failed':
        if (isWebhookInvoice(object)) {
          await this.onPaymentFailed(object);
        }
        break;
      case 'customer.subscription.deleted':
        if (isWebhookSubscription(object)) {
          await this.deps.subscriptions.markCancelled(object.id);
        }
        break;
      default:
        break;
    }

    return { received: true };
  }

  private async onPaymentSucceeded(invoice: WebhookInvoiceShape): Promise<void> {
    const order = invoice.payment_intent
      ? await this.deps.repo.findOrderByStripePaymentIntentId(invoice.payment_intent)
      : null;
    const resolvedOrder =
      order ??
      (invoice.subscription
        ? await this.deps.repo.findOrderByStripeSubscriptionId(invoice.subscription)
        : null);
    if (!resolvedOrder) {
      return;
    }

    await this.deps.orders.markPaid(resolvedOrder.orderId);
    await this.deps.invoices.create({
      orderId: resolvedOrder.orderId,
      invoiceUrl: invoice.invoice_pdf ?? invoice.hosted_invoice_url ?? null,
      paidAt: new Date(),
      dueDate: null,
    });

    if (invoice.subscription && invoice.period_end) {
      await this.deps.subscriptions.renew(invoice.subscription, new Date(invoice.period_end * 1000));
    }
  }

  private async onPaymentFailed(invoice: WebhookInvoiceShape): Promise<void> {
    const order = invoice.payment_intent
      ? await this.deps.repo.findOrderByStripePaymentIntentId(invoice.payment_intent)
      : null;
    const resolvedOrder =
      order ??
      (invoice.subscription
        ? await this.deps.repo.findOrderByStripeSubscriptionId(invoice.subscription)
        : null);
    if (!resolvedOrder) {
      return;
    }
    await this.deps.orders.markFailed(resolvedOrder.orderId);
    if (invoice.subscription) {
      await this.deps.subscriptions.markPaymentFailed(invoice.subscription);
    }
  }
}

export const stripeWebhookService = new StripeWebhookService();