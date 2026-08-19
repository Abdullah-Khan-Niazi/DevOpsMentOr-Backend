import { NotFoundError } from '../../../shared/errors';
import type { OrderDto, OrderStatus } from '../dto/billing.dto';
import type { BillingRepository, OrderInvoiceRow, OrderRow } from '../repositories/billing.repository';
import { billingRepository, toNumber } from '../repositories/billing.repository';

export interface OrderCreateInput {
  userId: number;
  subscriptionId: number | null;
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  currency: string;
  status: OrderStatus;
  paymentMethodId: number | null;
  stripePaymentIntentId: string | null;
}

export interface OrderServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'insertOrder'
    | 'nextOrderNumber'
    | 'markOrderPaid'
    | 'markOrderFailed'
    | 'markOrderRefunded'
    | 'listOrdersByUser'
    | 'findOrderById'
  >;
}

function defaultDeps(): OrderServiceDeps {
  return {
    repo: billingRepository,
  };
}

function toDto(row: OrderInvoiceRow): OrderDto {
  return {
    orderId: row.orderId,
    userId: row.userId,
    subscriptionId: row.subscriptionId,
    orderNumber: row.orderNumber,
    totalAmount: toNumber(row.totalAmount),
    discountAmount: toNumber(row.discountAmount),
    taxAmount: toNumber(row.taxAmount),
    finalAmount: toNumber(row.finalAmount),
    currency: row.currency,
    status: row.status,
    paymentMethodId: row.paymentMethodId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
  };
}

/**
 * F9 §08 order lifecycle (contract §05 invariant 6): every subscription
 * purchase creates one `orders` row with a unique `DM-ORD-{YYYY}-{NNNNNN}`
 * number and the stored `final_amount` computed at creation time.
 */
export class OrderService {
  constructor(private readonly deps: OrderServiceDeps = defaultDeps()) {}

  async create(input: OrderCreateInput): Promise<{ orderId: number; orderNumber: string }> {
    const now = new Date();
    const orderNumber = await this.deps.repo.nextOrderNumber(now);
    const orderId = await this.deps.repo.insertOrder({
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      orderNumber,
      totalAmount: input.totalAmount,
      discountAmount: input.discountAmount,
      taxAmount: input.taxAmount,
      finalAmount: input.totalAmount - input.discountAmount + input.taxAmount,
      currency: input.currency,
      status: input.status,
      paymentMethodId: input.paymentMethodId,
      stripePaymentIntentId: input.stripePaymentIntentId,
    });
    return { orderId, orderNumber };
  }

  async markPaid(orderId: number): Promise<void> {
    await this.deps.repo.markOrderPaid(orderId, new Date());
  }

  async markFailed(orderId: number): Promise<void> {
    await this.deps.repo.markOrderFailed(orderId);
  }

  async markRefunded(orderId: number): Promise<void> {
    await this.deps.repo.markOrderRefunded(orderId);
  }

  /** BIL-10: paginated own order history. */
  async listByUser(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ items: OrderDto[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.deps.repo.listOrdersByUser(userId, page, limit);
    return { items: rows.map(toDto), total, page, limit };
  }

  async getById(orderId: number): Promise<OrderRow | null> {
    return this.deps.repo.findOrderById(orderId);
  }

  async requireOrder(orderId: number): Promise<OrderRow> {
    const row = await this.deps.repo.findOrderById(orderId);
    if (!row) {
      throw new NotFoundError('Order not found.');
    }
    return row;
  }
}

export const orderService = new OrderService();