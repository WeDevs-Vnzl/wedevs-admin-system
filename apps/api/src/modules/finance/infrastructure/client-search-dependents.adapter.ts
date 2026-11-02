import type { ClientSearchDependentsPort } from '../../commercial/application/ports/client-search-dependents.port';
import type { SearchIndexPort } from '../../../shared/application/ports/search-index.port';
import type { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

/**
 * Rewrites the client label that the `INVOICE` and `PAYMENT` search entries carry as their subtitle (DT-166,
 * A15, A11). Archived, draft and voided invoices count: an explicit `deletedAt: undefined` opts out of the
 * soft-delete default, so a restored record shows the current label. It takes no row lock: the caller (the
 * client rename) holds the `Client` row and runs `Serializable`, so a concurrent invoice or payment mutation
 * that read the old label forms the read-write cycle Postgres aborts and the unit of work retries. Database
 * effects only, because the unit of work may repeat it.
 */
export class FinanceClientSearchDependents implements ClientSearchDependentsPort {
  constructor(
    private readonly host: TransactionHost,
    private readonly search: Pick<SearchIndexPort, 'setTexts'>,
  ) {}

  async relabelClient(clientId: string, label: string): Promise<number> {
    const db = this.host.db;
    const invoices = await db.invoice.findMany({
      where: { clientId, deletedAt: undefined },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const payments = await db.payment.findMany({
      where: { clientId, deletedAt: undefined },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const subtitle = (rows: readonly { id: string }[]) =>
      rows.map((row) => ({ entityId: row.id, subtitle: label }));
    const changedInvoices = await this.search.setTexts('INVOICE', subtitle(invoices));
    const changedPayments = await this.search.setTexts('PAYMENT', subtitle(payments));
    return changedInvoices + changedPayments;
  }
}
