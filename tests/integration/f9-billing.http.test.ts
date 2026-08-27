import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../src/shared/errors';
import { billingRoutes } from '../../src/features/billing/routes/billing.routes';

/**
 * F9 §11 HTTP integration + security matrix at the request layer.
 *
 * `authenticate` is stubbed to inject a session identity; every other
 * middleware (authorizePermissions, validateRequest, asyncHandler,
 * errorMiddleware) runs for real, and the F9 services are stubbed so no
 * database, Redis, or external Stripe call is touched.
 */

const session = vi.hoisted(() => ({
  user: null as null | {
    sub: string;
    permissions: string[];
    roles: string[];
  },
}));

vi.mock('../../src/shared/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/middleware')>();
  return {
    ...actual,
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      req.user = session.user as NonNullable<Request['user']>;
      next();
    },
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
  };
});

vi.mock('../../src/features/billing/services/plan.service', () => ({
  planService: {
    getCatalog: vi.fn(),
    getTier: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/subscription.service', () => ({
  subscriptionService: {
    create: vi.fn(),
    getCurrent: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/coupon.service', () => ({
  couponService: {
    validate: vi.fn(),
    apply: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/payment-method.service', () => ({
  paymentMethodService: {
    list: vi.fn(),
    add: vi.fn(),
    setDefault: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/order.service', () => ({
  orderService: {
    listByUser: vi.fn(),
    create: vi.fn(),
    markPaid: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/invoice.service', () => ({
  invoiceService: {
    listByUser: vi.fn(),
    getDownloadUrl: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/stripe-webhook.service', () => ({
  stripeWebhookService: {
    handle: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/stripe-portal.service', () => ({
  stripePortalService: {
    createSession: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/admin-billing.service', () => ({
  adminBillingService: {
    listSubscriptions: vi.fn(),
    adjustSubscription: vi.fn(),
    listOrders: vi.fn(),
    flagRefund: vi.fn(),
    getOverview: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/services/admin-coupon.service', () => ({
  adminCouponService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/features/billing/repositories/billing.repository', () => ({
  billingRepository: {
    getOrgId: vi.fn(async () => null),
  },
}));

import { subscriptionService } from '../../src/features/billing/services/subscription.service';
import { planService } from '../../src/features/billing/services/plan.service';
import { couponService } from '../../src/features/billing/services/coupon.service';
import { paymentMethodService } from '../../src/features/billing/services/payment-method.service';
import { orderService } from '../../src/features/billing/services/order.service';
import { invoiceService } from '../../src/features/billing/services/invoice.service';
import { stripeWebhookService } from '../../src/features/billing/services/stripe-webhook.service';
import { stripePortalService } from '../../src/features/billing/services/stripe-portal.service';
import { adminBillingService } from '../../src/features/billing/services/admin-billing.service';
import { adminCouponService } from '../../src/features/billing/services/admin-coupon.service';
import { errorMiddleware } from '../../src/shared/middleware';

const subscriptionServiceMock = vi.mocked(subscriptionService);
const planServiceMock = vi.mocked(planService);
const couponServiceMock = vi.mocked(couponService);
const paymentMethodServiceMock = vi.mocked(paymentMethodService);
const orderServiceMock = vi.mocked(orderService);
const invoiceServiceMock = vi.mocked(invoiceService);
const stripeWebhookServiceMock = vi.mocked(stripeWebhookService);
const stripePortalServiceMock = vi.mocked(stripePortalService);
const adminBillingServiceMock = vi.mocked(adminBillingService);
const adminCouponServiceMock = vi.mocked(adminCouponService);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', billingRoutes);
  app.use(errorMiddleware);
  return app;
}

const app = makeApp();

function asUser(user: { sub: number; permissions: string[]; roles?: string[] }): void {
  session.user = {
    sub: String(user.sub),
    permissions: user.permissions,
    roles: user.roles ?? [],
  };
}

const LEARNER: string[] = [];
const ADMIN = ['platform.billing.manage'];

describe('F9 §11 HTTP integration + security matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asUser({ sub: 7, permissions: LEARNER });
  });

  describe('BIL-01 plan catalog', () => {
    it('serves the plan catalog without authentication (target actor: Any)', async () => {
      planServiceMock.getCatalog.mockReturnValue({
        plans: [
          {
            planType: 'premium',
            displayName: 'Premium',
            monthlyPriceUsd: 19,
            annualPriceUsd: 190,
            features: {
              premiumLabsAccess: true,
              premiumCoursesAccess: true,
              labTtlHours: 8,
              labExtensionAllowed: true,
              aiMentorAccess: true,
              certificatesIncluded: true,
              downloadableResources: true,
              prioritySupport: false,
            },
          },
        ],
        currency: 'USD',
      });
      const res = await request(app).get('/billing/plans');
      expect(res.status).toBe(200);
      expect(res.body.data.plans[0].planType).toBe('premium');
      expect(planServiceMock.getCatalog).toHaveBeenCalledOnce();
    });
  });

  describe('BIL-02 create subscription', () => {
    it('returns 201 with the checkout client secret', async () => {
      subscriptionServiceMock.create.mockResolvedValue({
        subscriptionId: 9,
        orderId: 10,
        orderNumber: 'DM-ORD-2026-000001',
        finalAmount: 19,
        currency: 'usd',
        clientSecret: 'pi_1_secret',
        status: 'pending',
      });
      const res = await request(app)
        .post('/billing/subscriptions')
        .send({ planType: 'premium', billingCycle: 'monthly' });
      expect(res.status).toBe(201);
      expect(res.body.data.clientSecret).toBe('pi_1_secret');
      expect(subscriptionServiceMock.create).toHaveBeenCalledWith({
        userId: 7,
        organizationId: null,
        planType: 'premium',
        billingCycle: 'monthly',
        paymentMethodId: null,
        couponCode: null,
        currency: 'USD',
      });
    });

    it('rejects raw card data at the schema boundary with 422 (AC-07)', async () => {
      const res = await request(app).post('/billing/subscriptions').send({
        planType: 'premium',
        billingCycle: 'monthly',
        cardNumber: '4242424242424242',
        cvv: '123',
      });
      expect(res.status).toBe(422);
      expect(subscriptionServiceMock.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate-subscription conflict to 409', async () => {
      subscriptionServiceMock.create.mockRejectedValue(
        new ConflictError('SUBSCRIPTION_ALREADY_ACTIVE: You already have an active subscription.'),
      );
      const res = await request(app)
        .post('/billing/subscriptions')
        .send({ planType: 'premium', billingCycle: 'monthly' });
      expect(res.status).toBe(409);
    });
  });

  describe('BIL-04 cancel subscription', () => {
    it('rejects cancelling another users subscription via service ownership check (403)', async () => {
      subscriptionServiceMock.cancel.mockRejectedValue(new ForbiddenError('You can only cancel your own subscription.'));
      const res = await request(app).delete('/billing/subscriptions/1');
      expect(res.status).toBe(403);
      expect(subscriptionServiceMock.cancel).toHaveBeenCalledWith(1, 7, null);
    });

    it('cancels cleanly with 200 and access retained until end_date', async () => {
      subscriptionServiceMock.cancel.mockResolvedValue({
        subscriptionId: 1,
        cancelledAt: '2026-01-15T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
        isActive: true,
      });
      const res = await request(app).delete('/billing/subscriptions/1');
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });
  });

  describe('BIL-05 coupon validation', () => {
    it('validates a coupon and returns the discounted preview', async () => {
      couponServiceMock.validate.mockResolvedValue({
        couponId: 1,
        discountType: 'percentage',
        discountValue: 20,
        originalPrice: 19,
        discountAmount: 3.8,
        finalPrice: 15.2,
        expiresAt: '2027-01-01T00:00:00.000Z',
      });
      const res = await request(app)
        .post('/billing/coupons/validate')
        .send({ code: 'SAVE20', planType: 'premium', billingCycle: 'monthly' });
      expect(res.status).toBe(200);
      expect(res.body.data.finalPrice).toBe(15.2);
      expect(couponServiceMock.validate).toHaveBeenCalledWith('SAVE20', 'premium', 'monthly');
    });

    it('maps an unknown coupon to 404', async () => {
      couponServiceMock.validate.mockRejectedValue(new NotFoundError('This coupon does not exist.'));
      const res = await request(app)
        .post('/billing/coupons/validate')
        .send({ code: 'NOPE', planType: 'premium', billingCycle: 'monthly' });
      expect(res.status).toBe(404);
    });
  });

  describe('BIL-07 add payment method', () => {
    it('accepts tokenized identifiers only; raw card fields are rejected with 422', async () => {
      const res = await request(app).post('/billing/payment-methods').send({
        methodType: 'credit_card',
        stripePaymentMethodId: 'pm_1',
        cardNumber: '4242424242424242',
        pan: '4242424242424242',
      });
      expect(res.status).toBe(422);
      expect(paymentMethodServiceMock.add).not.toHaveBeenCalled();
    });

    it('adds a tokenized payment method with 201', async () => {
      paymentMethodServiceMock.add.mockResolvedValue({
        paymentMethodId: 1,
        methodType: 'credit_card',
        last4Digits: '4242',
        cardBrand: 'visa',
        stripePaymentMethodId: 'pm_1',
        paypalEmail: null,
        isDefault: true,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const res = await request(app)
        .post('/billing/payment-methods')
        .send({ methodType: 'credit_card', stripePaymentMethodId: 'pm_1' });
      expect(res.status).toBe(201);
      expect(res.body.data.isDefault).toBe(true);
    });
  });

  describe('BIL-09 remove payment method', () => {
    it('maps the default-in-use conflict to 409 (AC-08)', async () => {
      paymentMethodServiceMock.remove.mockRejectedValue(
        new ConflictError('DEFAULT_PAYMENT_METHOD_IN_USE: Set another default payment method before removing this one.'),
      );
      const res = await request(app).delete('/billing/payment-methods/1');
      expect(res.status).toBe(409);
    });
  });

  describe('BIL-13 stripe webhook', () => {
    it('does not require authentication and returns received:true', async () => {
      asUser({ sub: 7, permissions: LEARNER });
      stripeWebhookServiceMock.handle.mockResolvedValue({ received: true });
      const res = await request(app)
        .post('/billing/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=abc')
        .send({ type: 'invoice.payment_succeeded', data: { object: {} } });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ received: true });
      expect(stripeWebhookServiceMock.handle).toHaveBeenCalledTimes(1);
    });

    it('returns 400 for an invalid signature', async () => {
      stripeWebhookServiceMock.handle.mockRejectedValue(new BadRequestError('Invalid webhook signature.'));
      const res = await request(app)
        .post('/billing/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=bad')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('BIL-14 portal session', () => {
    it('returns the portal URL for an active Stripe subscription', async () => {
      stripePortalServiceMock.createSession.mockResolvedValue({ url: 'https://billing.stripe.com/session' });
      const res = await request(app).post('/billing/portal/session').send({});
      expect(res.status).toBe(200);
      expect(res.body.data.url).toContain('stripe.com');
    });
  });

  describe('BIL-16 admin adjust subscription', () => {
    it('blocks platform-admin billing routes without PLATFORM_BILLING_MANAGE (403)', async () => {
      asUser({ sub: 1, permissions: ['platform.users.manage'] });
      const res = await request(app)
        .patch('/billing/admin/subscriptions/1')
        .send({ planType: 'enterprise' });
      expect(res.status).toBe(403);
      expect(adminBillingServiceMock.adjustSubscription).not.toHaveBeenCalled();
    });

    it('adjusts a subscription with the permission granted', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminBillingServiceMock.adjustSubscription.mockResolvedValue({
        subscriptionId: 1,
        userId: 7,
        userEmail: 'a@b.c',
        userFullName: null,
        organizationId: null,
        organizationName: null,
        planName: 'Enterprise',
        planType: 'enterprise',
        autoRenew: true,
        isActive: true,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        cancelledAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const res = await request(app)
        .patch('/billing/admin/subscriptions/1')
        .send({ planType: 'enterprise' });
      expect(res.status).toBe(200);
      expect(res.body.data.planType).toBe('enterprise');
    });
  });

  describe('BIL-18 flag refund', () => {
    it('refuses to flag a non-paid order with 409', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminBillingServiceMock.flagRefund.mockRejectedValue(
        new ConflictError('ORDER_NOT_PAID: Only paid orders can be flagged for refund.'),
      );
      const res = await request(app).patch('/billing/admin/orders/1/refund');
      expect(res.status).toBe(409);
    });

    it('flags a paid order with 200', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminBillingServiceMock.flagRefund.mockResolvedValue(undefined);
      const res = await request(app).patch('/billing/admin/orders/1/refund');
      expect(res.status).toBe(200);
    });
  });

  describe('BIL-20 create coupon', () => {
    it('rejects an invalid coupon payload with 422', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      const res = await request(app)
        .post('/billing/admin/coupons')
        .send({ code: 'X', discountType: 'percentage', discountValue: 200, maxUses: 0, expiresAt: '2020-01-01T00:00:00.000Z' });
      expect(res.status).toBe(422);
      expect(adminCouponServiceMock.create).not.toHaveBeenCalled();
    });

    it('rejects a lowercase code at the schema boundary with 422 (BIL-20 uppercase enforced)', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      const res = await request(app)
        .post('/billing/admin/coupons')
        .send({ code: 'save20', discountType: 'percentage', discountValue: 20, expiresAt: '2027-01-01T00:00:00.000Z' });
      expect(res.status).toBe(422);
      expect(adminCouponServiceMock.create).not.toHaveBeenCalled();
    });

    it('creates a coupon with 201', async () => {
      asUser({ sub: 1, permissions: ADMIN });
      adminCouponServiceMock.create.mockResolvedValue({
        couponId: 1,
        code: 'SAVE20',
        description: null,
        discountType: 'percentage',
        discountValue: 20,
        maxUses: 5,
        usedCount: 0,
        expiresAt: '2027-01-01T00:00:00.000Z',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const res = await request(app)
        .post('/billing/admin/coupons')
        .send({ code: 'SAVE20', discountType: 'percentage', discountValue: 20, maxUses: 5, expiresAt: '2027-01-01T00:00:00.000Z' });
      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('SAVE20');
    });
  });

  describe('learner list endpoints', () => {
    it('lists own orders with pagination', async () => {
      orderServiceMock.listByUser.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
      const res = await request(app).get('/billing/orders');
      expect(res.status).toBe(200);
      expect(orderServiceMock.listByUser).toHaveBeenCalledWith(7, 1, 20);
    });

    it('lists own invoices with pagination', async () => {
      invoiceServiceMock.listByUser.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
      const res = await request(app).get('/billing/invoices');
      expect(res.status).toBe(200);
      expect(invoiceServiceMock.listByUser).toHaveBeenCalledWith(7, 1, 20);
    });
  });
});