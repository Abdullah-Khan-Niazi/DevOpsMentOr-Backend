import { describe, expect, it, vi } from 'vitest';
import { BadRequestError } from '../../../src/shared/errors';
import {
  StripeWebhookService,
  type StripeWebhookServiceDeps,
} from '../../../src/features/billing/services/stripe-webhook.service';
import type { OrderRow } from '../../../src/features/billing/repositories/billing.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const PAID_ORDER: OrderRow = {
  orderId: 10,
  userId: 7,
  subscriptionId: 1,
  orderNumber: 'DM-ORD-2026-000001',
  totalAmount: '19.00',
  discountAmount: '0.00',
  taxAmount: '0.00',
  finalAmount: '19.00',
  currency: 'usd',
  status: 'pending',
  paymentMethodId: null,
  stripePaymentIntentId: 'pi_1',
  paidAt: null,
  createdAt: new Date(),
};

function makeDeps(overrides: Partial<Mocked<StripeWebhookServiceDeps>> = {}): Mocked<StripeWebhookServiceDeps> {
  return {
    stripe: {
      verifyWebhookSignature: vi.fn(),
    },
    repo: {
      findOrderByStripePaymentIntentId: vi.fn(async () => null),
      findOrderByStripeSubscriptionId: vi.fn(async () => null),
    },
    orders: {
      markPaid: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    },
    invoices: {
      create: vi.fn(async () => ({ invoiceId: 5, invoiceNumber: 'DM-INV-2026-000005' })),
    },
    subscriptions: {
      renew: vi.fn(async () => undefined),
      markPaymentFailed: vi.fn(async () => null),
      markCancelled: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

describe('F9 StripeWebhookService (BIL-13, AC-05/06)', () => {
  it('rejects requests with an invalid signature before any processing', async () => {
    const deps = makeDeps();
    (deps.stripe.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const service = new StripeWebhookService(deps);
    await expect(service.handle(Buffer.from('{}'), 'bad-sig')).rejects.toThrow(BadRequestError);
    expect(deps.orders.markPaid).not.toHaveBeenCalled();
    expect(deps.invoices.create).not.toHaveBeenCalled();
  });

  it('marks the order paid and creates an invoice on payment_succeeded', async () => {
    const deps = makeDeps();
    (deps.repo.findOrderByStripePaymentIntentId as ReturnType<typeof vi.fn>).mockResolvedValue(PAID_ORDER);
    const service = new StripeWebhookService(deps);
    const result = await service.process({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_1',
          subscription: 'sub_123',
          payment_intent: 'pi_1',
          invoice_pdf: 'https://pay.stripe.com/invoice/invst_1/pdf',
          period_end: 1_767_225_600,
        },
      },
    } as never);
    expect(result).toEqual({ received: true });
    expect(deps.orders.markPaid).toHaveBeenCalledWith(10);
    expect(deps.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 10,
        invoiceUrl: 'https://pay.stripe.com/invoice/invst_1/pdf',
      }),
    );
    expect(deps.subscriptions.renew).toHaveBeenCalledWith('sub_123', new Date(1_767_225_600 * 1000));
  });

  it('marks the order failed and deactivates the subscription on payment_failed', async () => {
    const deps = makeDeps();
    (deps.repo.findOrderByStripePaymentIntentId as ReturnType<typeof vi.fn>).mockResolvedValue(PAID_ORDER);
    const service = new StripeWebhookService(deps);
    await service.process({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', subscription: 'sub_123', payment_intent: 'pi_1' } },
    } as never);
    expect(deps.orders.markFailed).toHaveBeenCalledWith(10);
    expect(deps.subscriptions.markPaymentFailed).toHaveBeenCalledWith('sub_123');
  });

  it('marks subscriptions cancelled on customer.subscription.deleted', async () => {
    const deps = makeDeps();
    const service = new StripeWebhookService(deps);
    await service.process({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_123' } },
    } as never);
    expect(deps.subscriptions.markCancelled).toHaveBeenCalledWith('sub_123');
  });

  it('always returns received:true for unknown event types', async () => {
    const service = new StripeWebhookService(makeDeps());
    await expect(
      service.process({ type: 'ping', data: { object: {} } } as never),
    ).resolves.toEqual({ received: true });
  });

  it('resolves the order via the Stripe subscription when no payment intent exists', async () => {
    const deps = makeDeps();
    (deps.repo.findOrderByStripeSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(PAID_ORDER);
    const service = new StripeWebhookService(deps);
    await service.process({
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_3', subscription: 'sub_123' } },
    } as never);
    expect(deps.repo.findOrderByStripeSubscriptionId).toHaveBeenCalledWith('sub_123');
    expect(deps.orders.markPaid).toHaveBeenCalledWith(10);
  });
});