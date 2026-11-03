import { Injectable } from '@nestjs/common';
import { InvoiceSupport } from '../../finance/application/use-cases/invoices/invoice-support';
import type {
  InvoiceForLink,
  InvoiceForLinkPort,
} from '../application/ports/invoice-for-link.port';

const OPEN_STATUSES: ReadonlySet<string> = new Set(['EMITIDA', 'PARCIAL', 'VENCIDA']);

/**
 * `InvoiceForLinkPort` over finance's exported `InvoiceSupport` (DT-110, rule (e)); no finance repository
 * is imported. `load` is a by-id read in the ambient transaction, so inside the link unit of work it sees
 * the balance under the `Invoice` lock. An unknown invoice is `NotFoundError`; an archived, draft, paid
 * or voided one is returned with `open: false`.
 */
@Injectable()
export class FinanceInvoiceForLink implements InvoiceForLinkPort {
  constructor(private readonly invoices: InvoiceSupport) {}

  async load(invoiceId: string): Promise<InvoiceForLink> {
    const invoice = await this.invoices.output(invoiceId);
    return {
      id: invoice.id,
      number: invoice.invoiceNumber,
      clientId: invoice.clientId,
      currency: invoice.currency,
      openBalance: invoice.balance,
      open: invoice.archivedAt === null && OPEN_STATUSES.has(invoice.status),
    };
  }
}
