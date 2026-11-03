export const INVOICE_FOR_LINK = Symbol('INVOICE_FOR_LINK');

/** The slice of an invoice a payment link needs. Adapter over finance's `GetInvoice` (2.6). */
export interface InvoiceForLink {
  readonly id: string;
  readonly number: string;
  readonly clientId: string;
  readonly currency: string;
  /** Decimal string: what remains to collect. */
  readonly openBalance: string;
  /** False for paid, voided or archived invoices. */
  readonly open: boolean;
}

export interface InvoiceForLinkPort {
  /** Throws `NotFoundError` for an unknown or deleted invoice (C14). */
  load(invoiceId: string): Promise<InvoiceForLink>;
}
