import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { orderService } from '../services/order.service';
import { userIdFrom } from './billing-actor';

/** F9 learner order endpoints (BIL-10). */
export class OrderController {
  /** BIL-10: paginated own order history. */
  async list(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; limit: number };
    const orders = await orderService.listByUser(userIdFrom(req), query.page, query.limit);
    return sendSuccess(res, orders, 'Orders retrieved successfully.');
  }
}

export const orderController = new OrderController();