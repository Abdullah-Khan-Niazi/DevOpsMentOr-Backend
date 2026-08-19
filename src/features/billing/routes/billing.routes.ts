import { Router } from 'express';
import { PERMISSIONS } from '../../../shared/constants';
import { authenticate, authorizePermissions, validateRequest } from '../../../shared/middleware';
import { asyncHandler } from '../../../shared/utils';
import {
  AdjustSubscriptionSchema,
  AddPaymentMethodSchema,
  AdminSearchQuerySchema,
  CouponIdParamSchema,
  CouponListQuerySchema,
  CreateCouponSchema,
  CreatePortalSessionSchema,
  CreateSubscriptionSchema,
  InvoiceIdParamSchema,
  OrderIdParamSchema,
  PaginatedQuerySchema,
  PaymentMethodIdParamSchema,
  SubscriptionIdParamSchema,
  UpdateCouponSchema,
  ValidateCouponSchema,
} from '../billing.schemas';
import {
  adminBillingController,
} from '../controllers/admin-billing.controller';
import {
  adminCouponController,
} from '../controllers/admin-coupon.controller';
import { couponController } from '../controllers/coupon.controller';
import { invoiceController } from '../controllers/invoice.controller';
import { orderController } from '../controllers/order.controller';
import { paymentMethodController } from '../controllers/payment-method.controller';
import { stripePortalController, stripeWebhookController } from '../controllers/stripe.controller';
import { subscriptionController } from '../controllers/subscription.controller';

const billingRoutes = Router();

/** ── BIL-01..05 learner subscription + coupon endpoints ─────────────── */
billingRoutes.get(
  '/plans',
  asyncHandler((req, res) => subscriptionController.getCatalog(req, res)),
);

billingRoutes.post(
  '/subscriptions',
  authenticate,
  validateRequest(CreateSubscriptionSchema, 'body'),
  asyncHandler((req, res) => subscriptionController.createSubscription(req, res)),
);

billingRoutes.get(
  '/subscriptions/current',
  authenticate,
  asyncHandler((req, res) => subscriptionController.getCurrentSubscription(req, res)),
);

billingRoutes.delete(
  '/subscriptions/:id',
  authenticate,
  validateRequest(SubscriptionIdParamSchema, 'params'),
  asyncHandler((req, res) => subscriptionController.cancelSubscription(req, res)),
);

billingRoutes.post(
  '/coupons/validate',
  authenticate,
  validateRequest(ValidateCouponSchema, 'body'),
  asyncHandler((req, res) => couponController.validate(req, res)),
);

/** ── BIL-06..09 learner payment methods ─────────────────────────────── */
billingRoutes.get(
  '/payment-methods',
  authenticate,
  asyncHandler((req, res) => paymentMethodController.list(req, res)),
);

billingRoutes.post(
  '/payment-methods',
  authenticate,
  validateRequest(AddPaymentMethodSchema, 'body'),
  asyncHandler((req, res) => paymentMethodController.add(req, res)),
);

billingRoutes.patch(
  '/payment-methods/:id/default',
  authenticate,
  validateRequest(PaymentMethodIdParamSchema, 'params'),
  asyncHandler((req, res) => paymentMethodController.setDefault(req, res)),
);

billingRoutes.delete(
  '/payment-methods/:id',
  authenticate,
  validateRequest(PaymentMethodIdParamSchema, 'params'),
  asyncHandler((req, res) => paymentMethodController.remove(req, res)),
);

/** ── BIL-10 learner orders ──────────────────────────────────────────── */
billingRoutes.get(
  '/orders',
  authenticate,
  validateRequest(PaginatedQuerySchema, 'query'),
  asyncHandler((req, res) => orderController.list(req, res)),
);

/** ── BIL-11/12 learner invoices ─────────────────────────────────────── */
billingRoutes.get(
  '/invoices',
  authenticate,
  validateRequest(PaginatedQuerySchema, 'query'),
  asyncHandler((req, res) => invoiceController.list(req, res)),
);

billingRoutes.get(
  '/invoices/:id/download',
  authenticate,
  validateRequest(InvoiceIdParamSchema, 'params'),
  asyncHandler((req, res) => invoiceController.download(req, res)),
);

/**
 * BIL-13: Stripe webhook ingestion. Deliberately NO `authenticate` and NO
 * `express.json()` (raw body is mounted app-wide at this exact prefix
 * before the global JSON parser; the signature is verified per request).
 */
billingRoutes.post(
  '/webhooks/stripe',
  asyncHandler((req, res) => stripeWebhookController.handle(req, res)),
);

/** ── BIL-14 Stripe Customer Portal session ──────────────────────────── */
billingRoutes.post(
  '/portal/session',
  authenticate,
  validateRequest(CreatePortalSessionSchema, 'body'),
  asyncHandler((req, res) => stripePortalController.createSession(req, res)),
);

/** ── BIL-15..18 + BIL-22 platform-admin billing ─────────────────────── */
billingRoutes.get(
  '/admin/subscriptions',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(AdminSearchQuerySchema, 'query'),
  asyncHandler((req, res) => adminBillingController.listSubscriptions(req, res)),
);

billingRoutes.patch(
  '/admin/subscriptions/:id',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(SubscriptionIdParamSchema, 'params'),
  validateRequest(AdjustSubscriptionSchema, 'body'),
  asyncHandler((req, res) => adminBillingController.adjustSubscription(req, res)),
);

billingRoutes.get(
  '/admin/orders',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(AdminSearchQuerySchema, 'query'),
  asyncHandler((req, res) => adminBillingController.listOrders(req, res)),
);

billingRoutes.patch(
  '/admin/orders/:id/refund',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(OrderIdParamSchema, 'params'),
  asyncHandler((req, res) => adminBillingController.flagRefund(req, res)),
);

billingRoutes.get(
  '/admin/overview',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  asyncHandler((req, res) => adminBillingController.getOverview(req, res)),
);

/** ── BIL-19..21 platform-admin coupons ──────────────────────────────── */
billingRoutes.get(
  '/admin/coupons',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(CouponListQuerySchema, 'query'),
  asyncHandler((req, res) => adminCouponController.list(req, res)),
);

billingRoutes.post(
  '/admin/coupons',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(CreateCouponSchema, 'body'),
  asyncHandler((req, res) => adminCouponController.create(req, res)),
);

billingRoutes.patch(
  '/admin/coupons/:id',
  authenticate,
  authorizePermissions(PERMISSIONS.PLATFORM_BILLING_MANAGE),
  validateRequest(CouponIdParamSchema, 'params'),
  validateRequest(UpdateCouponSchema, 'body'),
  asyncHandler((req, res) => adminCouponController.update(req, res)),
);

export { billingRoutes };