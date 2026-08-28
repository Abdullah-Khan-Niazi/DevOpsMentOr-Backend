import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/utils';
import { invoiceService } from '../services/invoice.service';
import { userIdFrom } from './billing-actor';

/** F9 learner invoice endpoints (BIL-11/12). */
export class InvoiceController {
  /** BIL-11: paginated own invoice list. */
  async list(req: Request, res: Response): Promise<Response> {
    const query = req.query as unknown as { page: number; limit: number };
    const invoices = await invoiceService.listByUser(userIdFrom(req), query.page, query.limit);
    return sendSuccess(res, invoices, 'Invoices retrieved successfully.');
  }

  /** BIL-12: signed PDF download URL (ownership checked via orders chain). */
  async download(req: Request, res: Response): Promise<Response> {
    const url = await invoiceService.getDownloadUrl(Number(req.params.id), userIdFrom(req));
    return sendSuccess(res, { signedUrl: url }, 'Invoice document retrieved successfully.');
  }
}

export const invoiceController = new InvoiceController();