import { ConflictError, ForbiddenError, PaymentRequiredError } from '../../../shared/errors';
import { notificationService } from '../../notifications';
import type { StripeAdapter } from '../adapters/stripe.adapter';
import { isCardDeclined, runStripeCall, stripeAdapter } from '../adapters/stripe.adapter';
import type {
  CancelSubscriptionDto,
  CreateSubscriptionResultDto,
  PlanType,
  SubscriptionChangedEvent,
  SubscriptionDto,
} from '../dto/billing.dto';
import type { BillingRepository, SubscriptionRow } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';
import type { CouponService } from './coupon.service';
import { couponService } from './coupon.service';
import type { OrderService } from './order.service';
import { orderService } from './order.service';
import type { PlanService } from './plan.service';
import { planService } from './plan.service';

export interface CreateSubscriptionInput {
  userId: number;
  organizationId: number | null;
  planType: Exclude<PlanType, 'free'>;
  billingCycle: 'monthly' | 'annual';
  paymentMethodId: number | null;
  couponCode: string | null;
  currency: string;
}

export interface SubscriptionServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'findActiveByUser'
    | 'findActiveOrgSubscription'
    | 'findOwnedById'
    | 'findOwnedPaymentMethod'
    | 'getOrgId'
    | 'getUserIdentity'
    | 'insertSubscriptionWithOrder'
    | 'nextOrderNumber'
    | 'updateOrderSubscription'
    | 'cancelSubscription'
    | 'updateSubscriptionEndDate'
    | 'markSubscriptionInactive'
    | 'findByStripeSubscriptionId'
    | 'findById'
  >;
  stripe: Pick<
    StripeAdapter,
    | 'getOrCreateCustomer'
    | 'createSubscription'
    | 'cancelSubscription'
    | 'getPriceId'
  >;
  plan: Pick<PlanService, 'getTier'>;
  orders: Pick<OrderService, 'create'>;
  coupons: Pick<CouponService, 'apply'>;
  notify: Pick<typeof notificationService, 'dispatch'>;
}

function defaultDeps(): SubscriptionServiceDeps {
  return {
    repo: billingRepository,
    stripe: stripeAdapter,
    plan: planService,
    orders: orderService,
    coupons: couponService,
    notify: notificationService,
  };
}

function toDto(row: SubscriptionRow): SubscriptionDto {
  return {
    subscriptionId: row.subscriptionId,
    userId: row.userId,
    organizationId: row.organizationId,
    planName: row.planName,
    planType: row.planType,
    stripeSubscriptionId: row.stripeSubscriptionId,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    autoRenew: row.autoRenew,
    isActive: row.isActive,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Billing-cycle end date resolution (invariant 12). */
export function resolveEndDate(start: Date, billingCycle: 'monthly' | 'annual'): Date {
  const end = new Date(start);
  if (billingCycle === 'monthly') {
    end.setUTCMonth(end.getUTCMonth() + 1);
  } else {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  }
  return end;
}

async function dispatchEvent(
  deps: SubscriptionServiceDeps,
  event: Omit<SubscriptionChangedEvent, 'planType'> & { planType: PlanType },
): Promise<void> {
  const title =
    event.eventType === 'subscribed'
      ? 'Subscription activated'
      : event.eventType === 'cancelled'
        ? 'Subscription cancelled'
        : event.eventType === 'payment_failed'
          ? 'Payment failed'
          : event.eventType === 'expired'
            ? 'Subscription expired'
            : 'Subscription renewed';
  const message =
    event.eventType === 'subscribed'
      ? `Your ${event.planType} plan is now active.`
      : event.eventType === 'cancelled'
        ? 'Your subscription stays active until the end of the billing period.'
        : event.eventType === 'payment_failed'
          ? 'We could not charge your payment method. Please update it to keep your plan.'
          : event.eventType === 'expired'
            ? 'Your subscription has ended. Renew to keep premium access.'
            : 'Your subscription was renewed for another period.';
  await deps.notify.dispatch({
    userId: event.userId,
    type: 'system',
    title,
    message,
  });
}

/**
 * F9 §08 subscription lifecycle (BIL-02/03/04). All identity is resolved
 * from the session; Stripe calls happen before any DB write and the
 * subscription + order INSERTs share one transaction (invariant 13).
 */
export class SubscriptionService {
  constructor(private readonly deps: SubscriptionServiceDeps = defaultDeps()) {}

  /** BIL-02: create an individual or org subscription with a pending order. */
  async create(input: CreateSubscriptionInput): Promise<CreateSubscriptionResultDto> {
    const existing = await this.deps.repo.findActiveByUser(input.userId);
    if (existing) {
      throw new ConflictError('SUBSCRIPTION_ALREADY_ACTIVE: You already have an active subscription.');
    }

    let resolvedOrgId: number | null = null;
    if (input.organizationId !== null) {
      const sessionOrgId = await this.deps.repo.getOrgId(input.userId);
      if (sessionOrgId === null || sessionOrgId !== input.organizationId) {
        throw new ForbiddenError('You can only manage subscriptions for your own organization.');
      }
      const orgSubscription = await this.deps.repo.findActiveOrgSubscription(input.organizationId);
      if (orgSubscription) {
        throw new ConflictError('SUBSCRIPTION_ALREADY_ACTIVE: Your organization already has an active subscription.');
      }
      resolvedOrgId = input.organizationId;
    }

    const tier = this.deps.plan.getTier(input.planType);
    const totalAmount =
      input.billingCycle === 'annual' ? tier.annualPriceUsd : tier.monthlyPriceUsd;
    const discount =
      input.couponCode !== null ? await this.deps.coupons.apply(input.couponCode, totalAmount) : null;
    const taxAmount = 0;
    const finalAmount = Math.max(0, totalAmount - (discount?.discountAmount ?? 0) + taxAmount);

    const identity = await this.deps.repo.getUserIdentity(input.userId);
    if (!identity) {
      throw new ForbiddenError('User identity could not be resolved.');
    }

    const priceId = this.deps.stripe.getPriceId(input.planType, input.billingCycle);
    const customer = await runStripeCall('getOrCreateCustomer', () =>
      this.deps.stripe.getOrCreateCustomer({
        userId: input.userId,
        email: identity.email,
        fullName: identity.fullName,
      }),
    );

    let paymentMethodToken: string | null = null;
    if (input.paymentMethodId !== null) {
      const method = await this.deps.repo.findOwnedPaymentMethod(input.paymentMethodId, input.userId);
      if (method) {
        paymentMethodToken = method.stripePaymentMethodId;
      }
    }

    const stripeResult = await runStripeCall('createSubscription', () =>
      this.deps.stripe.createSubscription({
        customerId: customer.id,
        priceId,
        userId: input.userId,
        paymentMethodId: paymentMethodToken,
        metadata: {
          planType: input.planType,
          billingCycle: input.billingCycle,
        },
      }),
    ).catch((err: unknown) => {
      if (isCardDeclined(err)) {
        throw new PaymentRequiredError('PAYMENT_DECLINED: Your card was declined. Try another payment method.');
      }
      throw err;
    });

    const now = new Date();
    const endDate = resolveEndDate(now, input.billingCycle);
    const orderNumber = await this.deps.repo.nextOrderNumber(now);
    const { subscriptionId, orderId } = await this.deps.repo.insertSubscriptionWithOrder(
      {
        userId: input.userId,
        organizationId: resolvedOrgId,
        planName: tier.displayName,
        planType: input.planType,
        stripeSubscriptionId: stripeResult.stripeSubscriptionId,
        startDate: now,
        endDate,
        autoRenew: true,
        isActive: true,
      },
      {
        userId: input.userId,
        subscriptionId: null,
        orderNumber,
        totalAmount,
        discountAmount: discount?.discountAmount ?? 0,
        taxAmount,
        finalAmount,
        currency: input.currency,
        status: 'pending',
        paymentMethodId: input.paymentMethodId,
        stripePaymentIntentId: null,
      },
    );
    // Rebind the order to the subscription it purchased.
    await this.deps.repo.updateOrderSubscription(orderId, subscriptionId);

    await dispatchEvent(this.deps, {
      userId: input.userId,
      organizationId: resolvedOrgId,
      eventType: 'subscribed',
      planType: input.planType,
      effectiveDate: now,
    });

    return {
      subscriptionId,
      orderId,
      orderNumber,
      finalAmount,
      currency: input.currency,
      clientSecret: stripeResult.clientSecret,
      status: 'pending',
    };
  }

  /** BIL-03: current subscription for the session user (free when none). */
  async getCurrent(userId: number): Promise<{ planType: PlanType; subscription: SubscriptionDto | null }> {
    const row = await this.deps.repo.findActiveByUser(userId);
    if (!row) {
      const orgId = await this.deps.repo.getOrgId(userId);
      if (orgId !== null) {
        const orgSub = await this.deps.repo.findActiveOrgSubscription(orgId);
        if (orgSub) {
          return { planType: orgSub.planType, subscription: toDto(orgSub) };
        }
      }
      return { planType: 'free', subscription: null };
    }
    return { planType: row.planType, subscription: toDto(row) };
  }

  /** BIL-04: soft cancellation; access continues until `end_date` (AC-09). */
  async cancel(subscriptionId: number, userId: number, organizationId: number | null): Promise<CancelSubscriptionDto> {
    const subscription = await this.deps.repo.findOwnedById(subscriptionId, userId, organizationId);
    if (!subscription) {
      throw new ForbiddenError('You can only cancel your own subscription.');
    }
    if (!subscription.isActive) {
      throw new ConflictError('This subscription is not active.');
    }
    if (subscription.stripeSubscriptionId) {
      const stripeSubscriptionId = subscription.stripeSubscriptionId;
      await runStripeCall('cancelSubscription', () =>
        this.deps.stripe.cancelSubscription(stripeSubscriptionId),
      );
    }
    await this.deps.repo.cancelSubscription(subscriptionId);

    await dispatchEvent(this.deps, {
      userId: subscription.userId,
      organizationId: subscription.organizationId,
      eventType: 'cancelled',
      planType: subscription.planType,
      effectiveDate: new Date(),
    });

    return {
      subscriptionId,
      cancelledAt: new Date().toISOString(),
      endDate: subscription.endDate ? subscription.endDate.toISOString() : null,
      isActive: true,
    };
  }

  /** Webhook-triggered renewal: extends `end_date` to the Stripe period end. */
  async renew(stripeSubscriptionId: string, newEndDate: Date): Promise<void> {
    const subscription = await this.deps.repo.findByStripeSubscriptionId(stripeSubscriptionId);
    if (!subscription) {
      return;
    }
    await this.deps.repo.updateSubscriptionEndDate(subscription.subscriptionId, newEndDate);
    await dispatchEvent(this.deps, {
      userId: subscription.userId,
      organizationId: subscription.organizationId,
      eventType: 'renewed',
      planType: subscription.planType,
      effectiveDate: new Date(),
    });
  }

  /** Webhook-triggered payment failure: subscription becomes inactive. */
  async markPaymentFailed(stripeSubscriptionId: string): Promise<SubscriptionRow | null> {
    const subscription = await this.deps.repo.findByStripeSubscriptionId(stripeSubscriptionId);
    if (!subscription) {
      return null;
    }
    await this.deps.repo.markSubscriptionInactive(subscription.subscriptionId);
    await dispatchEvent(this.deps, {
      userId: subscription.userId,
      organizationId: subscription.organizationId,
      eventType: 'payment_failed',
      planType: subscription.planType,
      effectiveDate: new Date(),
    });
    return subscription;
  }

  /** Webhook-triggered cancellation (`customer.subscription.deleted`). */
  async markCancelled(stripeSubscriptionId: string): Promise<void> {
    const subscription = await this.deps.repo.findByStripeSubscriptionId(stripeSubscriptionId);
    if (!subscription) {
      return;
    }
    await this.deps.repo.markSubscriptionInactive(subscription.subscriptionId);
    await this.deps.repo.cancelSubscription(subscription.subscriptionId);
    await dispatchEvent(this.deps, {
      userId: subscription.userId,
      organizationId: subscription.organizationId,
      eventType: 'cancelled',
      planType: subscription.planType,
      effectiveDate: new Date(),
    });
  }

  /** Nightly job: marks expired non-renewing subscriptions inactive (AC-14). */
  async markExpired(subscriptionId: number): Promise<void> {
    await this.deps.repo.markSubscriptionInactive(subscriptionId);
  }
}

export const subscriptionService = new SubscriptionService();