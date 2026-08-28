import { and, count, desc, eq, gte, gt, isNull, like, lt, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  academyCourses,
  coupons,
  invoices,
  labs,
  orders,
  organizations,
  paymentMethods,
  subscriptions,
  systemSettings,
  userSettings,
  users,
} from '../../../app/database/schema';
import { ORG_CONSTANTS } from '../../../shared/constants';
import type {
  DiscountType,
  OrderStatus,
  PaymentMethodType,
  PlanType,
} from '../dto/billing.dto';

/** Subscription row with user email/fullName and org name for admin views. */
export interface SubscriptionRow {
  subscriptionId: number;
  userId: number;
  organizationId: number | null;
  planName: string;
  planType: PlanType;
  stripeSubscriptionId: string | null;
  startDate: Date;
  endDate: Date | null;
  autoRenew: boolean;
  isActive: boolean;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface SubscriptionListRow extends SubscriptionRow {
  userEmail: string | null;
  userFullName: string | null;
  organizationName: string | null;
}

export interface PaymentMethodRow {
  paymentMethodId: number;
  userId: number;
  methodType: PaymentMethodType;
  last4Digits: string | null;
  cardBrand: string | null;
  stripePaymentMethodId: string | null;
  paypalEmail: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface OrderRow {
  orderId: number;
  userId: number;
  subscriptionId: number | null;
  orderNumber: string;
  totalAmount: string;
  discountAmount: string;
  taxAmount: string;
  finalAmount: string;
  currency: string;
  status: OrderStatus;
  paymentMethodId: number | null;
  stripePaymentIntentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface OrderListRow extends OrderRow {
  userEmail: string | null;
  userFullName: string | null;
}

/** Learner order row joined with its invoice (BIL-10, SCR-F9-04). */
export interface OrderInvoiceRow extends OrderRow {
  invoiceId: number | null;
  invoiceNumber: string | null;
}

export interface InvoiceRow {
  invoiceId: number;
  orderId: number;
  invoiceNumber: string;
  invoiceUrl: string | null;
  dueDate: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface CouponRow {
  couponId: number;
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface SubscriptionInsertInput {
  userId: number;
  organizationId: number | null;
  planName: string;
  planType: PlanType;
  stripeSubscriptionId: string | null;
  startDate: Date;
  endDate: Date | null;
  autoRenew: boolean;
  isActive: boolean;
}

export interface PaymentMethodInsertInput {
  userId: number;
  methodType: PaymentMethodType;
  last4Digits: string | null;
  cardBrand: string | null;
  stripePaymentMethodId: string | null;
  paypalEmail: string | null;
}

export interface OrderInsertInput {
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
}

export interface InvoiceInsertInput {
  orderId: number;
  invoiceNumber: string;
  invoiceUrl: string | null;
  dueDate: Date | null;
  paidAt: Date | null;
}

/** Money columns are returned as strings by mysql2; normalize to numbers. */
export function toNumber(value: string): number {
  return Number(value);
}

/**
 * F9 data access layer. All identity/org scoping is resolved from
 * session-derived arguments; repository methods NEVER accept client
 * identifiers for ownership scoping (BOLA/IDOR mitigation).
 */
export class BillingRepository {
  /* ── subscriptions ──────────────────────────────────────────────────── */

  async findActiveByUser(userId: number): Promise<SubscriptionRow | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.isActive, true),
          or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
        ),
      )
      .orderBy(desc(subscriptions.startDate))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active org-level subscription (invariant 1 exception: org admins). */
  async findActiveOrgSubscription(organizationId: number): Promise<SubscriptionRow | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.isActive, true),
          or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
        ),
      )
      .orderBy(desc(subscriptions.startDate))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveSubscriptionByUser(userId: number): Promise<SubscriptionRow | null> {
    return this.findActiveByUser(userId);
  }

  async findOwnedById(
    subscriptionId: number,
    userId: number,
    organizationId: number | null,
  ): Promise<SubscriptionRow | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.subscriptionId, subscriptionId),
          or(
            eq(subscriptions.userId, userId),
            organizationId === null
              ? sql`false`
              : eq(subscriptions.organizationId, organizationId),
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(subscriptionId: number): Promise<SubscriptionRow | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.subscriptionId, subscriptionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertSubscription(input: SubscriptionInsertInput): Promise<number> {
    const inserted = await db
      .insert(subscriptions)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        planName: input.planName,
        planType: input.planType,
        stripeSubscriptionId: input.stripeSubscriptionId,
        startDate: input.startDate,
        endDate: input.endDate,
        autoRenew: input.autoRenew,
        isActive: input.isActive,
      })
      .$returningId();
    return inserted[0].subscriptionId;
  }

  async cancelSubscription(subscriptionId: number): Promise<void> {
    await db
      .update(subscriptions)
      .set({ cancelledAt: new Date(), autoRenew: false })
      .where(eq(subscriptions.subscriptionId, subscriptionId));
  }

  async markSubscriptionInactive(subscriptionId: number): Promise<void> {
    await db
      .update(subscriptions)
      .set({ isActive: false })
      .where(eq(subscriptions.subscriptionId, subscriptionId));
  }

  async updateSubscriptionEndDate(subscriptionId: number, endDate: Date): Promise<void> {
    await db
      .update(subscriptions)
      .set({ endDate, isActive: true })
      .where(eq(subscriptions.subscriptionId, subscriptionId));
  }

  async adjustSubscription(
    subscriptionId: number,
    fields: Partial<{
      planType: PlanType;
      autoRenew: boolean;
      isActive: boolean;
      endDate: Date;
    }>,
  ): Promise<void> {
    await db.update(subscriptions).set(fields).where(eq(subscriptions.subscriptionId, subscriptionId));
  }

  /** Expired non-renewing subscriptions (nightly job, AC-14). */
  async listExpiredNonRenewing(now: Date): Promise<SubscriptionRow[]> {
    return db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.isActive, true),
          eq(subscriptions.autoRenew, false),
          gt(subscriptions.endDate, new Date(0)),
          lt(subscriptions.endDate, now),
        ),
      );
  }

  async listForAdmin(
    page: number,
    limit: number,
    search: string | undefined,
    planType: PlanType | undefined,
  ): Promise<{ rows: SubscriptionListRow[]; total: number }> {
    const filters = [
      ...(search ? [or(like(users.email, `%${search}%`), like(users.fullName, `%${search}%`))] : []),
      ...(planType ? [eq(subscriptions.planType, planType)] : []),
    ];
    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          subscriptionId: subscriptions.subscriptionId,
          userId: subscriptions.userId,
          organizationId: subscriptions.organizationId,
          planName: subscriptions.planName,
          planType: subscriptions.planType,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          startDate: subscriptions.startDate,
          endDate: subscriptions.endDate,
          autoRenew: subscriptions.autoRenew,
          isActive: subscriptions.isActive,
          cancelledAt: subscriptions.cancelledAt,
          createdAt: subscriptions.createdAt,
          userEmail: users.email,
          userFullName: users.fullName,
          organizationName: organizations.name,
        })
        .from(subscriptions)
        .leftJoin(users, eq(users.userId, subscriptions.userId))
        .leftJoin(organizations, eq(organizations.organizationId, subscriptions.organizationId))
        .where(whereClause)
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: count() })
        .from(subscriptions)
        .leftJoin(users, eq(users.userId, subscriptions.userId))
        .where(whereClause),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async findAdminSubscriptionById(subscriptionId: number): Promise<SubscriptionListRow | null> {
    const rows = await db
      .select({
        subscriptionId: subscriptions.subscriptionId,
        userId: subscriptions.userId,
        organizationId: subscriptions.organizationId,
        planName: subscriptions.planName,
        planType: subscriptions.planType,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
        startDate: subscriptions.startDate,
        endDate: subscriptions.endDate,
        autoRenew: subscriptions.autoRenew,
        isActive: subscriptions.isActive,
        cancelledAt: subscriptions.cancelledAt,
        createdAt: subscriptions.createdAt,
        userEmail: users.email,
        userFullName: users.fullName,
        organizationName: organizations.name,
      })
      .from(subscriptions)
      .leftJoin(users, eq(users.userId, subscriptions.userId))
      .leftJoin(organizations, eq(organizations.organizationId, subscriptions.organizationId))
      .where(eq(subscriptions.subscriptionId, subscriptionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async countActive(): Promise<number> {
    const rows = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.isActive, true),
          or(isNull(subscriptions.endDate), gt(subscriptions.endDate, new Date())),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async countActiveByPlan(): Promise<Record<PlanType, number>> {
    const rows = await db
      .select({ planType: subscriptions.planType, count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.isActive, true))
      .groupBy(subscriptions.planType);
    const summary: Record<PlanType, number> = { free: 0, premium: 0, enterprise: 0, student: 0 };
    for (const row of rows) {
      summary[row.planType] = row.count;
    }
    return summary;
  }

  /* ── payment methods ────────────────────────────────────────────────── */

  async listPaymentMethods(userId: number): Promise<PaymentMethodRow[]> {
    return db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.isActive, true)))
      .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt));
  }

  async findOwnedPaymentMethod(paymentMethodId: number, userId: number): Promise<PaymentMethodRow | null> {
    const rows = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.paymentMethodId, paymentMethodId), eq(paymentMethods.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertPaymentMethod(input: PaymentMethodInsertInput): Promise<number> {
    const inserted = await db
      .insert(paymentMethods)
      .values({
        userId: input.userId,
        methodType: input.methodType,
        last4Digits: input.last4Digits,
        cardBrand: input.cardBrand,
        stripePaymentMethodId: input.stripePaymentMethodId,
        paypalEmail: input.paypalEmail,
      })
      .$returningId();
    return inserted[0].paymentMethodId;
  }

  /** Clears all defaults for a user (invariant 9, transaction-safe). */
  async clearDefaultPaymentMethods(userId: number): Promise<void> {
    await db
      .update(paymentMethods)
      .set({ isDefault: false })
      .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.isDefault, true)));
  }

  /**
   * Exactly-one-default enforcement (invariant 9, AC): clears every default
   * for the user, then sets the target within a single transaction.
   */
  async setDefaultPaymentMethodForUser(paymentMethodId: number, userId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(paymentMethods)
        .set({ isDefault: false })
        .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.isDefault, true)));
      await tx.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.paymentMethodId, paymentMethodId));
    });
  }

  async setDefaultPaymentMethod(paymentMethodId: number): Promise<void> {
    await db.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.paymentMethodId, paymentMethodId));
  }

  async deactivatePaymentMethod(paymentMethodId: number): Promise<void> {
    await db
      .update(paymentMethods)
      .set({ isActive: false, isDefault: false })
      .where(eq(paymentMethods.paymentMethodId, paymentMethodId));
  }

  async hasActiveAutoRenewSubscription(userId: number): Promise<boolean> {
    const rows = await db
      .select({ subscriptionId: subscriptions.subscriptionId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.isActive, true),
          eq(subscriptions.autoRenew, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /* ── orders ─────────────────────────────────────────────────────────── */

  async findOrderById(orderId: number): Promise<OrderRow | null> {
    const rows = await db.select().from(orders).where(eq(orders.orderId, orderId)).limit(1);
    return rows[0] ?? null;
  }

  async findOrderByStripePaymentIntentId(paymentIntentId: string): Promise<OrderRow | null> {
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.stripePaymentIntentId, paymentIntentId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Latest order for a Stripe subscription (webhook fallback lookup). */
  async findOrderBySubscriptionId(subscriptionId: number): Promise<OrderRow | null> {
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.subscriptionId, subscriptionId))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Order lookup by Stripe subscription id (two-hop webhook resolution). */
  async findOrderByStripeSubscriptionId(stripeSubscriptionId: string): Promise<OrderRow | null> {
    const subRows = await db
      .select({ id: subscriptions.subscriptionId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    if (!subRows[0]) {
      return null;
    }
    return this.findOrderBySubscriptionId(subRows[0].id);
  }

  async listOrdersByUser(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ rows: OrderInvoiceRow[]; total: number }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          orderId: orders.orderId,
          userId: orders.userId,
          subscriptionId: orders.subscriptionId,
          orderNumber: orders.orderNumber,
          totalAmount: orders.totalAmount,
          discountAmount: orders.discountAmount,
          taxAmount: orders.taxAmount,
          finalAmount: orders.finalAmount,
          currency: orders.currency,
          status: orders.status,
          paymentMethodId: orders.paymentMethodId,
          stripePaymentIntentId: orders.stripePaymentIntentId,
          paidAt: orders.paidAt,
          createdAt: orders.createdAt,
          invoiceId: invoices.invoiceId,
          invoiceNumber: invoices.invoiceNumber,
        })
        .from(orders)
        .leftJoin(invoices, eq(invoices.orderId, orders.orderId))
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ count: count() }).from(orders).where(eq(orders.userId, userId)),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async insertOrder(input: OrderInsertInput): Promise<number> {
    const inserted = await db
      .insert(orders)
      .values({
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        orderNumber: input.orderNumber,
        totalAmount: input.totalAmount.toFixed(2),
        discountAmount: input.discountAmount.toFixed(2),
        taxAmount: input.taxAmount.toFixed(2),
        finalAmount: input.finalAmount.toFixed(2),
        currency: input.currency,
        status: input.status,
        paymentMethodId: input.paymentMethodId,
        stripePaymentIntentId: input.stripePaymentIntentId,
      })
      .$returningId();
    return inserted[0].orderId;
  }

  /**
   * Subscription + pending order INSERT within one transaction so a Stripe
   * failure never leaves an orphaned row (invariant 13).
   */
  async insertSubscriptionWithOrder(
    subscriptionInput: SubscriptionInsertInput,
    orderInput: OrderInsertInput,
  ): Promise<{ subscriptionId: number; orderId: number }> {
    return db.transaction(async (tx) => {
      const subInserted = await tx
        .insert(subscriptions)
        .values({
          userId: subscriptionInput.userId,
          organizationId: subscriptionInput.organizationId,
          planName: subscriptionInput.planName,
          planType: subscriptionInput.planType,
          stripeSubscriptionId: subscriptionInput.stripeSubscriptionId,
          startDate: subscriptionInput.startDate,
          endDate: subscriptionInput.endDate,
          autoRenew: subscriptionInput.autoRenew,
          isActive: subscriptionInput.isActive,
        })
        .$returningId();
      const subscriptionId = subInserted[0].subscriptionId;
      const orderInserted = await tx
        .insert(orders)
        .values({
          userId: orderInput.userId,
          subscriptionId,
          orderNumber: orderInput.orderNumber,
          totalAmount: orderInput.totalAmount.toFixed(2),
          discountAmount: orderInput.discountAmount.toFixed(2),
          taxAmount: orderInput.taxAmount.toFixed(2),
          finalAmount: orderInput.finalAmount.toFixed(2),
          currency: orderInput.currency,
          status: orderInput.status,
          paymentMethodId: orderInput.paymentMethodId,
          stripePaymentIntentId: orderInput.stripePaymentIntentId,
        })
        .$returningId();
      return { subscriptionId, orderId: orderInserted[0].orderId };
    });
  }

  async markOrderPaid(orderId: number, paidAt: Date): Promise<void> {
    await db.update(orders).set({ status: 'paid', paidAt }).where(eq(orders.orderId, orderId));
  }

  async markOrderFailed(orderId: number): Promise<void> {
    await db.update(orders).set({ status: 'failed' }).where(eq(orders.orderId, orderId));
  }

  async updateOrderSubscription(orderId: number, subscriptionId: number): Promise<void> {
    await db.update(orders).set({ subscriptionId }).where(eq(orders.orderId, orderId));
  }

  async markOrderRefunded(orderId: number): Promise<void> {
    await db.update(orders).set({ status: 'refunded' }).where(eq(orders.orderId, orderId));
  }

  async listOrdersForAdmin(
    page: number,
    limit: number,
    search: string | undefined,
    status: OrderStatus | undefined,
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const filters = [
      ...(search ? [or(like(users.email, `%${search}%`), like(users.fullName, `%${search}%`), like(orders.orderNumber, `%${search}%`))] : []),
      ...(status ? [eq(orders.status, status)] : []),
    ];
    const whereClause = filters.length > 0 ? and(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          orderId: orders.orderId,
          userId: orders.userId,
          subscriptionId: orders.subscriptionId,
          orderNumber: orders.orderNumber,
          totalAmount: orders.totalAmount,
          discountAmount: orders.discountAmount,
          taxAmount: orders.taxAmount,
          finalAmount: orders.finalAmount,
          currency: orders.currency,
          status: orders.status,
          paymentMethodId: orders.paymentMethodId,
          stripePaymentIntentId: orders.stripePaymentIntentId,
          paidAt: orders.paidAt,
          createdAt: orders.createdAt,
          userEmail: users.email,
          userFullName: users.fullName,
        })
        .from(orders)
        .leftJoin(users, eq(users.userId, orders.userId))
        .where(whereClause)
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ count: count() }).from(orders).leftJoin(users, eq(users.userId, orders.userId)).where(whereClause),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async sumPaidRevenue(): Promise<number> {
    const rows = await db
      .select({ total: sql<string>`COALESCE(SUM(${orders.finalAmount}), 0)` })
      .from(orders)
      .where(eq(orders.status, 'paid'));
    return toNumber(rows[0]?.total ?? '0');
  }

  async countPendingRefunds(): Promise<number> {
    const rows = await db
      .select({ count: count() })
      .from(orders)
      .where(or(eq(orders.status, 'failed'), eq(orders.status, 'pending')));
    return rows[0]?.count ?? 0;
  }

  /** Currently redeemable coupons (active and not yet expired). */
  async countActiveCoupons(now: Date): Promise<number> {
    const rows = await db
      .select({ count: count() })
      .from(coupons)
      .where(and(eq(coupons.isActive, true), gte(coupons.expiresAt, now)));
    return rows[0]?.count ?? 0;
  }

  /** Next sequence number for `DM-ORD-{YYYY}-{NNNNNN}` (invariant 6). */
  async nextOrderNumber(now: Date): Promise<string> {
    const rows = await db
      .select({ maxId: sql<number>`COALESCE(MAX(${orders.orderId}), 0)` })
      .from(orders);
    const next = (rows[0]?.maxId ?? 0) + 1;
    return `DM-ORD-${now.getUTCFullYear()}-${String(next).padStart(6, '0')}`;
  }

  /* ── invoices ───────────────────────────────────────────────────────── */

  async insertInvoice(input: InvoiceInsertInput): Promise<number> {
    const inserted = await db
      .insert(invoices)
      .values({
        orderId: input.orderId,
        invoiceNumber: input.invoiceNumber,
        invoiceUrl: input.invoiceUrl,
        dueDate: input.dueDate,
        paidAt: input.paidAt,
      })
      .$returningId();
    return inserted[0].invoiceId;
  }

  async findInvoiceOwnedByUser(invoiceId: number, userId: number): Promise<InvoiceRow | null> {
    const rows = await db
      .select({
        invoiceId: invoices.invoiceId,
        orderId: invoices.orderId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceUrl: invoices.invoiceUrl,
        dueDate: invoices.dueDate,
        paidAt: invoices.paidAt,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .innerJoin(orders, eq(orders.orderId, invoices.orderId))
      .where(and(eq(invoices.invoiceId, invoiceId), eq(orders.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listInvoicesByUser(userId: number, page: number, limit: number): Promise<{ rows: InvoiceRow[]; total: number }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          invoiceId: invoices.invoiceId,
          orderId: invoices.orderId,
          invoiceNumber: invoices.invoiceNumber,
          invoiceUrl: invoices.invoiceUrl,
          dueDate: invoices.dueDate,
          paidAt: invoices.paidAt,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .innerJoin(orders, eq(orders.orderId, invoices.orderId))
        .where(eq(orders.userId, userId))
        .orderBy(desc(invoices.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: count() })
        .from(invoices)
        .innerJoin(orders, eq(orders.orderId, invoices.orderId))
        .where(eq(orders.userId, userId)),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  /** Next sequence number for `DM-INV-{YYYY}-{NNNNNN}` (invariant 7). */
  async nextInvoiceNumber(now: Date): Promise<string> {
    const rows = await db.select({ maxId: sql<number>`COALESCE(MAX(${invoices.invoiceId}), 0)` }).from(invoices);
    const next = (rows[0]?.maxId ?? 0) + 1;
    return `DM-INV-${now.getUTCFullYear()}-${String(next).padStart(6, '0')}`;
  }

  /* ── coupons ────────────────────────────────────────────────────────── */

  async findCouponByCode(code: string): Promise<CouponRow | null> {
    const rows = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
    return rows[0] ?? null;
  }

  async findCouponById(couponId: number): Promise<CouponRow | null> {
    const rows = await db.select().from(coupons).where(eq(coupons.couponId, couponId)).limit(1);
    return rows[0] ?? null;
  }

  async insertCoupon(input: {
    code: string;
    description: string | null;
    discountType: DiscountType;
    discountValue: string;
    maxUses: number;
    expiresAt: Date;
    isActive: boolean;
  }): Promise<number> {
    const inserted = await db
      .insert(coupons)
      .values({
        code: input.code,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
        isActive: input.isActive,
      })
      .$returningId();
    return inserted[0].couponId;
  }

  async updateCoupon(
    couponId: number,
    fields: Partial<{
      description: string | null;
      discountType: DiscountType;
      discountValue: string;
      maxUses: number;
      expiresAt: Date;
      isActive: boolean;
    }>,
  ): Promise<void> {
    await db.update(coupons).set(fields).where(eq(coupons.couponId, couponId));
  }

  /**
   * Atomic usage increment (invariant 3, AC-03): the guarded UPDATE prevents
   * over-redemption under concurrent requests.
   */
  async incrementCouponUsage(couponId: number): Promise<boolean> {
    const result = await db
      .update(coupons)
      .set({ usedCount: sql`${coupons.usedCount} + 1` })
      .where(and(eq(coupons.couponId, couponId), sql`${coupons.usedCount} < ${coupons.maxUses}`));
    return (result[0]?.affectedRows ?? 0) > 0;
  }

  async listCouponsForAdmin(
    page: number,
    limit: number,
    search: string | undefined,
  ): Promise<{ rows: CouponRow[]; total: number }> {
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(coupons)
        .where(search ? like(coupons.code, `%${search.toUpperCase()}%`) : undefined)
        .orderBy(desc(coupons.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ count: count() }).from(coupons).where(search ? like(coupons.code, `%${search.toUpperCase()}%`) : undefined),
    ]);
    return { rows, total: totalRows[0]?.count ?? 0 };
  }

  async countRedemptionsThisMonth(now: Date): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await db
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.status, 'paid'), gte(orders.createdAt, monthStart), sql`${orders.discountAmount} > 0`));
    return rows[0]?.count ?? 0;
  }

  /* ── cross-feature reads (Drizzle JOINs; no direct F2/F3 imports) ───── */

  async getUserIdentity(userId: number): Promise<{ email: string; fullName: string | null } | null> {
    const rows = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Org affiliation from `user_settings.org_id` (F3 §06 adaptation). */
  async getOrgId(userId: number): Promise<number | null> {
    const rows = await db
      .select({ settingValue: userSettings.settingValue })
      .from(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY)))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? Number.NaN : Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /** Active org member count from the `org_id` affiliation store. */
  async countOrgMembers(orgId: number): Promise<number> {
    const rows = await db
      .select({ count: count() })
      .from(userSettings)
      .where(
        and(
          eq(userSettings.settingKey, ORG_CONSTANTS.ORG_ID_SETTING_KEY),
          sql`CAST(${userSettings.settingValue} AS SIGNED) = ${orgId}`,
        ),
      );
    return rows[0]?.count ?? 0;
  }

  /** Org seat allowance from `system_settings` (plan_seats_{plan_type}). */
  async getPlanSeatLimit(planType: PlanType): Promise<number | null> {
    const rows = await db
      .select({ settingValue: systemSettings.settingValue })
      .from(systemSettings)
      .where(eq(systemSettings.settingKey, `plan_seats_${planType}`))
      .limit(1);
    const raw = rows[0]?.settingValue;
    const parsed = raw == null ? Number.NaN : Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /* ── entitlement gate reads (F4/F6 premium flags) ───────────────────── */

  async findLabPremiumFlag(labId: number): Promise<boolean | null> {
    const rows = await db
      .select({ isPremium: labs.isPremium })
      .from(labs)
      .where(eq(labs.labId, labId))
      .limit(1);
    return rows[0]?.isPremium ?? null;
  }

  async findCoursePremiumFlag(courseId: number): Promise<boolean | null> {
    const rows = await db
      .select({ isPremium: academyCourses.isPremium })
      .from(academyCourses)
      .where(eq(academyCourses.courseId, courseId))
      .limit(1);
    return rows[0]?.isPremium ?? null;
  }
}

export const billingRepository = new BillingRepository();