import { ConflictError, NotFoundError } from '../../../shared/errors';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import { notificationService } from '../../notifications';
import { auditLogService } from '../../admin/services/audit-log.service';
import type {
  AdminOrderRowDto,
  AdminSubscriptionRowDto,
  BillingActor,
  BillingOverviewDto,
  PlanType,
} from '../dto/billing.dto';
import type { BillingRepository, OrderListRow, SubscriptionListRow } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';
import type { PlanService } from './plan.service';
import { planService } from './plan.service';

export interface AdjustSubscriptionInput {
  planType?: PlanType;
  autoRenew?: boolean;
  isActive?: boolean;
  endDate?: string;
}

export interface AdminBillingServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'listForAdmin'
    | 'findAdminSubscriptionById'
    | 'findById'
    | 'adjustSubscription'
    | 'listOrdersForAdmin'
    | 'findOrderById'
    | 'markOrderRefunded'
    | 'sumPaidRevenue'
    | 'countPendingRefunds'
    | 'countActive'
    | 'countActiveByPlan'
    | 'countRedemptionsThisMonth'
    | 'countActiveCoupons'
  >;
  plan: Pick<PlanService, 'getTier'>;
  audit: typeof auditLogService;
  notify: Pick<typeof notificationService, 'dispatch'>;
}

function defaultDeps(): AdminBillingServiceDeps {
  return { repo: billingRepository, plan: planService, audit: auditLogService, notify: notificationService };
}

function toSubscriptionDto(row: SubscriptionListRow): AdminSubscriptionRowDto {
  return {
    subscriptionId: row.subscriptionId,
    userId: row.userId,
    userEmail: row.userEmail ?? '',
    userFullName: row.userFullName,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    planName: row.planName,
    planType: row.planType,
    autoRenew: row.autoRenew,
    isActive: row.isActive,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toOrderDto(row: OrderListRow): AdminOrderRowDto {
  return {
    orderId: row.orderId,
    userId: row.userId,
    userEmail: row.userEmail ?? '',
    userFullName: row.userFullName,
    orderNumber: row.orderNumber,
    totalAmount: toNumber(row.totalAmount),
    discountAmount: toNumber(row.discountAmount),
    taxAmount: toNumber(row.taxAmount),
    finalAmount: toNumber(row.finalAmount),
    currency: row.currency,
    status: row.status,
    subscriptionId: row.subscriptionId,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseFloat(value);
}

/**
 * F9 §08 platform-admin billing operations (BIL-15..18, BIL-22). Every
 * mutation records an `audit_logs` row (F2 invariant 8); user-facing state
 * changes also emit an F8 notification.
 */
export class AdminBillingService {
  constructor(private readonly deps: AdminBillingServiceDeps = defaultDeps()) {}

  /** BIL-15: paginated subscriptions with email/name search and plan filter. */
  async listSubscriptions(
    page: number,
    limit: number,
    search: string | undefined,
    planType: PlanType | undefined,
  ): Promise<{ items: AdminSubscriptionRowDto[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.deps.repo.listForAdmin(page, limit, search, planType);
    return { items: rows.map(toSubscriptionDto), total, page, limit };
  }

  /** BIL-16: plan/auto-renew/status adjustment with audit trail. */
  async adjustSubscription(
    subscriptionId: number,
    actor: BillingActor,
    input: AdjustSubscriptionInput,
  ): Promise<AdminSubscriptionRowDto> {
    const existing = await this.deps.repo.findById(subscriptionId);
    if (!existing) {
      throw new NotFoundError('Subscription not found.');
    }

    const changes: Record<string, unknown> = {};
    const fields: Partial<{
      planType: PlanType;
      autoRenew: boolean;
      isActive: boolean;
      endDate: Date;
      planName: string;
    }> = {};

    if (input.planType !== undefined && input.planType !== existing.planType) {
      fields.planType = input.planType;
      fields.planName = this.deps.plan.getTier(input.planType).displayName;
      changes.planType = { from: existing.planType, to: input.planType };
    }
    if (input.autoRenew !== undefined && input.autoRenew !== existing.autoRenew) {
      fields.autoRenew = input.autoRenew;
      changes.autoRenew = { from: existing.autoRenew, to: input.autoRenew };
    }
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      fields.isActive = input.isActive;
      changes.isActive = { from: existing.isActive, to: input.isActive };
    }
    if (input.endDate !== undefined) {
      const endDate = new Date(input.endDate);
      fields.endDate = endDate;
      changes.endDate = { from: existing.endDate?.toISOString() ?? null, to: endDate.toISOString() };
    }

    if (Object.keys(fields).length > 0) {
      await this.deps.repo.adjustSubscription(subscriptionId, fields);
      await this.deps.audit.record({
        adminUserId: actor.userId,
        action: AUDIT_ACTIONS.ADJUST_SUBSCRIPTION,
        targetType: 'subscription',
        targetId: subscriptionId,
        changes,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    const updated = await this.deps.repo.findAdminSubscriptionById(subscriptionId);
    if (!updated) {
      throw new NotFoundError('Subscription not found.');
    }
    return toSubscriptionDto(updated);
  }

  /** BIL-17: paginated orders with search and status filter. */
  async listOrders(
    page: number,
    limit: number,
    search: string | undefined,
    status: AdminOrderRowDto['status'] | undefined,
  ): Promise<{ items: AdminOrderRowDto[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.deps.repo.listOrdersForAdmin(page, limit, search, status);
    return { items: rows.map(toOrderDto), total, page, limit };
  }

  /** BIL-18: flag a paid order for refund (audit + user notification). */
  async flagRefund(
    orderId: number,
    actor: BillingActor,
  ): Promise<void> {
    const order = await this.deps.repo.findOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }
    if (order.status !== 'paid') {
      throw new ConflictError('ORDER_NOT_PAID: Only paid orders can be flagged for refund.');
    }

    await this.deps.repo.markOrderRefunded(orderId);
    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.FLAG_REFUND,
      targetType: 'order',
      targetId: orderId,
      changes: { status: { from: order.status, to: 'refunded' } },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    await this.deps.notify.dispatch({
      userId: order.userId,
      type: 'system',
      title: 'Refund requested',
      message: 'Your order was flagged for a refund. Our team will process it shortly.',
    });
  }

  /** BIL-22: aggregate platform billing metrics. */
  async getOverview(): Promise<BillingOverviewDto> {
    const [
      activeSubscriptions,
      byPlan,
      monthlyRevenue,
      couponRedemptionsThisMonth,
      openRefundFlags,
      activeCoupons,
    ] = await Promise.all([
      this.deps.repo.countActive(),
      this.deps.repo.countActiveByPlan(),
      this.deps.repo.sumPaidRevenue(),
      this.deps.repo.countRedemptionsThisMonth(new Date()),
      this.deps.repo.countPendingRefunds(),
      this.deps.repo.countActiveCoupons(new Date()),
    ]);
    return {
      activeSubscriptions,
      byPlan,
      monthlyRevenue,
      couponRedemptionsThisMonth,
      openRefundFlags,
      activeCoupons,
    };
  }
}

export const adminBillingService = new AdminBillingService();