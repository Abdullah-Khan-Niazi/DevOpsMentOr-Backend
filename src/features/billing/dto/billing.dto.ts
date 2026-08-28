/**
 * F9 §05 response DTOs and shared domain types. All dates are ISO strings
 * unless noted. Mirrors the contract §05 domain model and §07 endpoint
 * response shapes.
 */

export type PlanType = 'free' | 'premium' | 'enterprise' | 'student';
export type BillingCycle = 'monthly' | 'annual';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
export type PaymentMethodType = 'credit_card' | 'paypal' | 'crypto' | 'bank_transfer' | 'enterprise_invoice';
export type DiscountType = 'percentage' | 'fixed_amount';

/** Request actor derived from the authenticated session (F2 §04). */
export interface BillingActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Plan tier feature matrix (static config; §05 PlanTier interface). */
export interface PlanTierDto {
  planType: PlanType;
  displayName: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  features: {
    premiumLabsAccess: boolean;
    premiumCoursesAccess: boolean;
    labTtlHours: number;
    labExtensionAllowed: boolean;
    aiMentorAccess: boolean;
    certificatesIncluded: boolean;
    downloadableResources: boolean;
    prioritySupport: boolean;
  };
}

/** BIL-01 catalog item. */
export interface PlanCatalogDto {
  plans: PlanTierDto[];
  currency: string;
}

export interface SubscriptionDto {
  subscriptionId: number;
  userId: number;
  organizationId: number | null;
  planName: string;
  planType: PlanType;
  stripeSubscriptionId: string | null;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  isActive: boolean;
  cancelledAt: string | null;
  createdAt: string;
}

export interface PaymentMethodDto {
  paymentMethodId: number;
  methodType: PaymentMethodType;
  last4Digits: string | null;
  cardBrand: string | null;
  stripePaymentMethodId: string | null;
  paypalEmail: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface OrderDto {
  orderId: number;
  userId: number;
  subscriptionId: number | null;
  orderNumber: string;
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  finalAmount: number;
  currency: string;
  status: OrderStatus;
  paymentMethodId: number | null;
  stripePaymentIntentId: string | null;
  paidAt: string | null;
  createdAt: string;
  /** Present once the invoice exists (paid orders); drives SCR-F9-04. */
  invoiceId: number | null;
  invoiceNumber: string | null;
}

export interface InvoiceDto {
  invoiceId: number;
  orderId: number;
  invoiceNumber: string;
  invoiceUrl: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CouponDto {
  couponId: number;
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
}

/** BIL-05 coupon validation preview. */
export interface CouponValidationDto {
  couponId: number;
  discountType: DiscountType;
  discountValue: number;
  originalPrice: number;
  discountAmount: number;
  finalPrice: number;
  expiresAt: string;
}

/** BIL-02 subscription creation response. */
export interface CreateSubscriptionResultDto {
  subscriptionId: number;
  orderId: number;
  orderNumber: string;
  finalAmount: number;
  currency: string;
  clientSecret: string | null;
  status: 'pending' | 'paid';
}

/** BIL-04 cancellation response. */
export interface CancelSubscriptionDto {
  subscriptionId: number;
  cancelledAt: string;
  endDate: string | null;
  isActive: boolean;
}

/** BIL-14 Stripe Customer Portal session. */
export interface PortalSessionDto {
  url: string;
}

/** BIL-12 invoice download response. */
export interface InvoiceDownloadDto {
  signedUrl: string;
}

/** SubscriptionChangedEvent consumed by F8 notification dispatch (§02). */
export interface SubscriptionChangedEvent {
  userId: number;
  organizationId: number | null;
  eventType: 'subscribed' | 'cancelled' | 'renewed' | 'payment_failed' | 'expired';
  planType: PlanType;
  effectiveDate: Date;
}

/** Entitlement gate result consumed by F5 and F6 (§02). */
export interface EntitlementResult {
  allowed: boolean;
  reason:
    | 'active_subscription'
    | 'free_content'
    | 'no_subscription'
    | 'plan_insufficient'
    | 'org_seat_exceeded';
  planType: PlanType | null;
}

/** Active subscription summary consumed by F8 analytics (§02). */
export interface ActiveSubscriptionSummary {
  total: number;
  byPlan: Record<PlanType, number>;
}

/** BIL-22 admin billing overview. */
export interface BillingOverviewDto {
  activeSubscriptions: number;
  byPlan: Record<PlanType, number>;
  monthlyRevenue: number;
  couponRedemptionsThisMonth: number;
  openRefundFlags: number;
  activeCoupons: number;
}

/** Admin subscription list row (BIL-15). */
export interface AdminSubscriptionRowDto {
  subscriptionId: number;
  userId: number;
  userEmail: string;
  userFullName: string | null;
  organizationId: number | null;
  organizationName: string | null;
  planName: string;
  planType: PlanType;
  autoRenew: boolean;
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** Admin order list row (BIL-17). */
export interface AdminOrderRowDto {
  orderId: number;
  userId: number;
  userEmail: string;
  userFullName: string | null;
  orderNumber: string;
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  finalAmount: number;
  currency: string;
  status: OrderStatus;
  subscriptionId: number | null;
  paidAt: string | null;
  createdAt: string;
}