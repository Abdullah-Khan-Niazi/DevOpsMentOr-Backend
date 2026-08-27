import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, PaymentRequiredError } from '../../../src/shared/errors';
import {
  SubscriptionService,
  resolveEndDate,
  type SubscriptionServiceDeps,
} from '../../../src/features/billing/services/subscription.service';
import type { SubscriptionRow } from '../../../src/features/billing/repositories/billing.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const ACTIVE_ROW: SubscriptionRow = {
  subscriptionId: 1,
  userId: 7,
  organizationId: null,
  planName: 'DevOps Mentor Premium',
  planType: 'premium',
  stripeSubscriptionId: 'sub_123',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-02-01T00:00:00.000Z'),
  autoRenew: true,
  isActive: true,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeDeps(overrides: Partial<Mocked<SubscriptionServiceDeps>> = {}): Mocked<SubscriptionServiceDeps> {
  return {
    repo: {
      findActiveByUser: vi.fn(async () => null),
      findActiveOrgSubscription: vi.fn(async () => null),
      findOwnedById: vi.fn(async () => null),
      findOwnedPaymentMethod: vi.fn(async () => null),
      getOrgId: vi.fn(async () => null),
      getUserIdentity: vi.fn(async () => ({ email: 'a@b.c', fullName: 'A' })),
      insertSubscriptionWithOrder: vi.fn(async () => ({ subscriptionId: 9, orderId: 10 })),
      nextOrderNumber: vi.fn(async () => 'DM-ORD-2026-000001'),
      updateOrderSubscription: vi.fn(async () => undefined),
      cancelSubscription: vi.fn(async () => undefined),
      updateSubscriptionEndDate: vi.fn(async () => undefined),
      markSubscriptionInactive: vi.fn(async () => undefined),
      findByStripeSubscriptionId: vi.fn(async () => null),
      findById: vi.fn(async () => null),
    },
    stripe: {
      getOrCreateCustomer: vi.fn(async () => ({ id: 'cus_1' })),
      createSubscription: vi.fn(async () => ({ stripeSubscriptionId: 'sub_999', clientSecret: 'pi_1_secret' })),
      cancelSubscription: vi.fn(async () => undefined),
      getPriceId: vi.fn(() => 'price_1'),
    },
    plan: {
      getTier: vi.fn((planType) => ({
        planType,
        displayName: 'DevOps Mentor Premium',
        monthlyPriceUsd: 19,
        annualPriceUsd: 190,
        features: {
          premiumLabsAccess: true,
          premiumCoursesAccess: true,
          labTtlHours: 4,
          labExtensionAllowed: true,
          aiMentorAccess: true,
          certificatesIncluded: true,
          downloadableResources: true,
          prioritySupport: false,
        },
      })),
    },
    orders: {
      create: vi.fn(async () => ({ orderId: 10, orderNumber: 'DM-ORD-2026-000001' })),
    },
    coupons: {
      apply: vi.fn(async () => ({ discountAmount: 0, couponId: 1 })),
    },
    notify: {
      dispatch: vi.fn(async () => ({ inApp: true, email: false })),
    },
    ...overrides,
  };
}

const baseInput = {
  userId: 7,
  organizationId: null,
  planType: 'premium' as const,
  billingCycle: 'monthly' as const,
  paymentMethodId: null,
  couponCode: null,
  currency: 'usd',
};

describe('F9 SubscriptionService (BIL-02/03/04)', () => {
  it('rejects a second active subscription with 409 SUBSCRIPTION_ALREADY_ACTIVE', async () => {
    const deps = makeDeps();
    (deps.repo.findActiveByUser as ReturnType<typeof vi.fn>).mockResolvedValue(ACTIVE_ROW);
    const service = new SubscriptionService(deps);
    await expect(service.create(baseInput)).rejects.toThrow(
      expect.objectContaining({ message: expect.stringContaining('SUBSCRIPTION_ALREADY_ACTIVE') }),
    );
    await expect(service.create(baseInput)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects org subscriptions for users not affiliated with that org (403)', async () => {
    const deps = makeDeps();
    (deps.repo.getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    const service = new SubscriptionService(deps);
    await expect(
      service.create({ ...baseInput, organizationId: 3 }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('creates a subscription with a pending order inside one transaction', async () => {
    const deps = makeDeps();
    (deps.repo.insertSubscriptionWithOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      subscriptionId: 9,
      orderId: 10,
    });
    const service = new SubscriptionService(deps);
    const result = await service.create(baseInput);
    expect(deps.stripe.createSubscription).toHaveBeenCalledTimes(1);
    expect(deps.repo.insertSubscriptionWithOrder).toHaveBeenCalledTimes(1);
    expect(deps.repo.updateOrderSubscription).toHaveBeenCalledWith(10, 9);
    expect(result).toEqual(
      expect.objectContaining({
        subscriptionId: 9,
        orderId: 10,
        orderNumber: 'DM-ORD-2026-000001',
        finalAmount: 19,
        clientSecret: 'pi_1_secret',
        status: 'pending',
      }),
    );
    expect(deps.notify.dispatch).toHaveBeenCalledWith({
      userId: 7,
      type: 'system',
      title: 'Subscription activated',
      message: 'Your premium plan is now active.',
    });
  });

  it('does not insert DB rows when Stripe fails (invariant 13)', async () => {
    const deps = makeDeps();
    (deps.stripe.createSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stripe down'));
    const service = new SubscriptionService(deps);
    await expect(service.create(baseInput)).rejects.toThrow('stripe down');
    expect(deps.repo.insertSubscriptionWithOrder).not.toHaveBeenCalled();
    expect(deps.repo.updateOrderSubscription).not.toHaveBeenCalled();
  });

  it('maps a Stripe card decline to 402 Payment Required (BIL-02)', async () => {
    const deps = makeDeps();
    (deps.stripe.createSubscription as ReturnType<typeof vi.fn>).mockRejectedValue({
      type: 'StripeCardError',
      code: 'card_declined',
      message: 'Your card was declined.',
    });
    const service = new SubscriptionService(deps);
    await expect(service.create(baseInput)).rejects.toBeInstanceOf(PaymentRequiredError);
    await expect(service.create(baseInput)).rejects.toThrow('PAYMENT_DECLINED');
    expect(deps.repo.insertSubscriptionWithOrder).not.toHaveBeenCalled();
  });

  it('returns the active subscription as current, or a free summary otherwise', async () => {
    const deps = makeDeps();
    (deps.repo.findActiveByUser as ReturnType<typeof vi.fn>).mockResolvedValue(ACTIVE_ROW);
    const service = new SubscriptionService(deps);
    const current = await service.getCurrent(7);
    expect(current.planType).toBe('premium');
    expect(current.subscription?.subscriptionId).toBe(1);

    const freeDeps = makeDeps();
    const freeService = new SubscriptionService(freeDeps);
    await expect(freeService.getCurrent(7)).resolves.toEqual({ planType: 'free', subscription: null });
  });

  it('only allows cancelling own subscriptions (403 otherwise)', async () => {
    const deps = makeDeps();
    const service = new SubscriptionService(deps);
    await expect(service.cancel(1, 7, null)).rejects.toThrow(ForbiddenError);
  });

  it('cancels via Stripe and marks the row cancelled while keeping access active', async () => {
    const deps = makeDeps();
    (deps.repo.findOwnedById as ReturnType<typeof vi.fn>).mockResolvedValue(ACTIVE_ROW);
    const service = new SubscriptionService(deps);
    const result = await service.cancel(1, 7, null);
    expect(deps.stripe.cancelSubscription).toHaveBeenCalledWith('sub_123');
    expect(deps.repo.cancelSubscription).toHaveBeenCalledWith(1);
    expect(result.isActive).toBe(true);
    expect(result.endDate).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('resolveEndDate (invariant 12)', () => {
  it('adds one month for monthly billing', () => {
    const end = resolveEndDate(new Date('2026-01-15T00:00:00.000Z'), 'monthly');
    expect(end.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('adds one year for annual billing', () => {
    const end = resolveEndDate(new Date('2026-01-15T00:00:00.000Z'), 'annual');
    expect(end.toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});