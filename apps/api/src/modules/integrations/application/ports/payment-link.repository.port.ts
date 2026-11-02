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
  /**
   * `DEACTIVATED` links with an `externalId` whose provider deactivation is not confirmed yet, oldest
   * deactivation first. The daily job repeats the call for each until it succeeds (DT-196).
   */
  listPendingProviderDeactivation(): Promise<PaymentLink[]>;
  /** Records that the provider confirmed the link is off; the link leaves the pending list for good. */
  markProviderDeactivated(linkId: string, at: Date): Promise<void>;
}
