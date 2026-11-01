import type { ClientFinanceDependentsPort } from '../../commercial/application/ports/client-finance-dependents.port';
import type { InvoiceRepository } from '../application/ports/invoice.repository.port';

/**
 * `commercial`'s `ClientFinanceDependentsPort` over finance's invoice repository (Q-BE2-1, HU-08 CA3 side of
 * C19): a client with an invoice still to collect (`EMITIDA|PARCIAL|VENCIDA`, live, not a draft) needs the
 * archive confirmation. `openInvoices` reads inside the caller's unit of work, after its client lock.
 */
export class FinanceClientDependents implements ClientFinanceDependentsPort {
  constructor(private readonly invoices: Pick<InvoiceRepository, 'openInvoices'>) {}

  async hasOpenInvoices(clientId: string): Promise<boolean> {
    return (await this.invoices.openInvoices(clientId)).length > 0;
  }
}
