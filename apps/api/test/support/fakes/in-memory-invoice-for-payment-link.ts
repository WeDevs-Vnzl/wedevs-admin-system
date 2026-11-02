import type {
  InvoiceForLink,
  InvoiceForLinkPort,
} from '../../../src/modules/integrations/application/ports/invoice-for-link.port';
import { NotFoundError } from '../../../src/shared/domain';

/** Fake `InvoiceForLinkPort`. */
export class InMemoryInvoiceForPaymentLink implements InvoiceForLinkPort {
  private readonly invoices = new Map<string, InvoiceForLink>();

  add(invoice: InvoiceForLink): void {
    this.invoices.set(invoice.id, invoice);
  }

  async load(invoiceId: string): Promise<InvoiceForLink> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new NotFoundError();
    return invoice;
  }
}
