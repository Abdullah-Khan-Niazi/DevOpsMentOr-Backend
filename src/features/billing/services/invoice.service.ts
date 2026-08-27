import { NotFoundError } from '../../../shared/errors';
import type { InvoiceDto } from '../dto/billing.dto';
import type { BillingRepository, InvoiceRow } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';

export interface InvoiceCreateInput {
  orderId: number;
  invoiceUrl: string | null;
  paidAt: Date | null;
  dueDate: Date | null;
}

export interface InvoiceServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'insertInvoice'
    | 'nextInvoiceNumber'
    | 'findInvoiceOwnedByUser'
    | 'listInvoicesByUser'
  >;
}

function defaultDeps(): InvoiceServiceDeps {
  return { repo: billingRepository };
}

function toDto(row: InvoiceRow): InvoiceDto {
  return {
    invoiceId: row.invoiceId,
    orderId: row.orderId,
    invoiceNumber: row.invoiceNumber,
    invoiceUrl: row.invoiceUrl,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * F9 §08 invoice generation (contract §05 invariant 7). One `invoices` row
 * is inserted per successful payment with a unique `DM-INV-{YYYY}-{NNNNNN}`
 * number. PDF rendering is an external concern: `invoice_url` stores the
 * reference and the `pdf_data` LONGBLOB column is NEVER written (AC-11).
 */
export class InvoiceService {
  constructor(private readonly deps: InvoiceServiceDeps = defaultDeps()) {}

  async create(input: InvoiceCreateInput): Promise<{ invoiceId: number; invoiceNumber: string }> {
    const now = new Date();
    const invoiceNumber = await this.deps.repo.nextInvoiceNumber(now);
    const invoiceId = await this.deps.repo.insertInvoice({
      orderId: input.orderId,
      invoiceNumber,
      invoiceUrl: input.invoiceUrl,
      dueDate: input.dueDate,
      paidAt: input.paidAt,
    });
    return { invoiceId, invoiceNumber };
  }

  /** BIL-11: paginated own invoice list. */
  async listByUser(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{ items: InvoiceDto[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.deps.repo.listInvoicesByUser(userId, page, limit);
    return { items: rows.map(toDto), total, page, limit };
  }

  /**
   * BIL-12: resolves the signed PDF URL. Ownership is verified through the
   * `invoices → orders → user_id` chain (AC-12); a missing reference is an
   * honest operational state (PDF generation is external to F9).
   */
  async getDownloadUrl(invoiceId: number, userId: number): Promise<string> {
    const invoice = await this.deps.repo.findInvoiceOwnedByUser(invoiceId, userId);
    if (!invoice) {
      throw new NotFoundError('Invoice not found.');
    }
    if (!invoice.invoiceUrl) {
      throw new NotFoundError('The invoice document is not available yet.');
    }
    return invoice.invoiceUrl;
  }
}

export const invoiceService = new InvoiceService();