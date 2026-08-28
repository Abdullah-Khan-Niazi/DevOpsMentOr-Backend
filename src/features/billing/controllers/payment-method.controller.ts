import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { paymentMethodService } from '../services/payment-method.service';
import { userIdFrom } from './billing-actor';

/** F9 learner payment-method endpoints (BIL-06..09). */
export class PaymentMethodController {
  /** BIL-06: list own payment methods. */
  async list(req: Request, res: Response): Promise<Response> {
    const methods = await paymentMethodService.list(userIdFrom(req));
    return sendSuccess(res, methods, 'Payment methods retrieved successfully.');
  }

  /** BIL-07: add a tokenized payment method. */
  async add(req: Request, res: Response): Promise<Response> {
    const userId = userIdFrom(req);
    const body = req.body as {
      stripePaymentMethodId?: string;
      methodType: 'credit_card' | 'paypal' | 'enterprise_invoice';
      paypalEmail?: string;
    };
    const method = await paymentMethodService.add(userId, {
      stripePaymentMethodId: body.stripePaymentMethodId ?? null,
      methodType: body.methodType,
      paypalEmail: body.paypalEmail ?? null,
    });
    return sendSuccess(res, method, 'Payment method added successfully.', 201);
  }

  /** BIL-08: set default payment method. */
  async setDefault(req: Request, res: Response): Promise<Response> {
    const method = await paymentMethodService.setDefault(Number(req.params.id), userIdFrom(req));
    return sendSuccess(res, method, 'Default payment method updated successfully.');
  }

  /** BIL-09: remove a payment method. */
  async remove(req: Request, res: Response): Promise<Response> {
    await paymentMethodService.remove(Number(req.params.id), userIdFrom(req));
    return sendSuccess(res, null, 'Payment method removed successfully.');
  }
}

export const paymentMethodController = new PaymentMethodController();