import type { PaymentLink } from '../../domain/payment-link';

export const PAYMENT_LINK_REPOSITORY = Symbol('PAYMENT_LINK_REPOSITORY');

export interface PaymentLinkRepository {
  /** Inserts a new link or replaces the stored one with the same id. */
  save(link: PaymentLink): Promise<void>;
  findById(id: string): Promise<PaymentLink | null>;
  /** The link a repeated request returns instead of creating a second one. */
  findByRequestId(invoiceId: string, requestId: string): Promise<PaymentLink | null>;
  findByExternalId(externalId: string): Promise<PaymentLink | null>;
  /** Every link of the invoice, newest first (ties by id descending). */
  listByInvoice(invoiceId: string): Promise<PaymentLink[]>;
  /** Invoices holding at least one `PENDING` or `ACTIVE` link: the daily job's worklist. */
  listInvoiceIdsWithOpenLinks(): Promise<string[]>;
}
