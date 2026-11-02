import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { InvoiceForLinkPort } from '../../ports/invoice-for-link.port';
import type { PaymentLinkRepository } from '../../ports/payment-link.repository.port';
import { capacityOf, toPaymentLinkOutput, type PaymentLinkOutput } from './payment-link-support';

export interface InvoicePaymentLinksOutput {
  /** Every link of the invoice, newest first. */
  readonly links: readonly PaymentLinkOutput[];
  /** What a new link may still carry (decimal string; zero when the invoice cannot carry links). */
  readonly capacity: string;
}

/** `ListInvoicePaymentLinks`: `payment` `read`; the links of one invoice and its remaining capacity. */
export class ListInvoicePaymentLinks {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceForLinkPort,
    private readonly links: PaymentLinkRepository,
  ) {}

  async execute(actor: CurrentUser, invoiceId: string): Promise<InvoicePaymentLinksOutput> {
    assertCan(this.authorization, actor, 'read', 'payment');
    const invoice = await this.invoices.load(invoiceId);
    const links = await this.links.listByInvoice(invoice.id);
    return { links: links.map(toPaymentLinkOutput), capacity: capacityOf(invoice, links) };
  }
}
