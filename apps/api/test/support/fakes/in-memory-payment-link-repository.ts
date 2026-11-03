import type { PaymentLinkRepository } from '../../../src/modules/integrations/application/ports/payment-link.repository.port';
import {
  isOpenLinkStatus,
  type PaymentLink,
} from '../../../src/modules/integrations/domain/payment-link';

/** Fake `PaymentLinkRepository`. */
export class InMemoryPaymentLinkRepository implements PaymentLinkRepository {
  private readonly rows = new Map<string, PaymentLink>();
  private readonly confirmedOff = new Map<string, Date>();

  async save(link: PaymentLink): Promise<void> {
    this.rows.set(link.id, link);
  }

  async findById(id: string): Promise<PaymentLink | null> {
    return this.rows.get(id) ?? null;
  }

  async findByRequestId(invoiceId: string, requestId: string): Promise<PaymentLink | null> {
    return (
      [...this.rows.values()].find((l) => l.invoiceId === invoiceId && l.requestId === requestId) ??
      null
    );
  }

  async findByExternalId(externalId: string): Promise<PaymentLink | null> {
    return [...this.rows.values()].find((l) => l.externalId === externalId) ?? null;
  }

  async listByInvoice(invoiceId: string): Promise<PaymentLink[]> {
    return [...this.rows.values()]
      .filter((l) => l.invoiceId === invoiceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }

  async listInvoiceIdsWithOpenLinks(): Promise<string[]> {
    const ids = new Set<string>();
    for (const link of this.rows.values())
      if (isOpenLinkStatus(link.status)) ids.add(link.invoiceId);
    return [...ids].sort();
  }

  async listPendingProviderDeactivation(): Promise<PaymentLink[]> {
    return [...this.rows.values()]
      .filter(
        (l) => l.status === 'DEACTIVATED' && l.externalId !== null && !this.confirmedOff.has(l.id),
      )
      .sort(
        (a, b) =>
          (a.deactivatedAt?.getTime() ?? 0) - (b.deactivatedAt?.getTime() ?? 0) ||
          (a.id < b.id ? -1 : 1),
      );
  }

  async markProviderDeactivated(linkId: string, at: Date): Promise<void> {
    if (this.rows.has(linkId)) this.confirmedOff.set(linkId, at);
  }
}
