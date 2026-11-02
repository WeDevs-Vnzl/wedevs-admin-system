import type { PaymentMethodSearchDependentsPort } from '../../settings/application/ports/payment-method-search-dependents.port';
import type { SearchIndexPort } from '../../../shared/application/ports/search-index.port';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { paymentSearchBody } from '../application/use-cases/payments/payment-support';

/**
 * Rewrites the method name that `PAYMENT` search entries carry in their `body` (DT-166, A15, A11): each
 * payment's body is rebuilt by the same function the payment mutations use, so the two cannot drift. Archived
 * payments count (an explicit `deletedAt: undefined`). It takes no lock: there is no lock class for catalogs;
 * the caller (the method rename) runs `Serializable`, so a payment mutation that read the old name forms the
 * read-write cycle Postgres aborts and the unit of work retries. Database effects only.
 */
export class FinancePaymentMethodSearchDependents implements PaymentMethodSearchDependentsPort {
  constructor(
    private readonly host: TransactionHost,
    private readonly search: Pick<SearchIndexPort, 'setTexts'>,
  ) {}

  async relabelMethod(methodId: string, name: string): Promise<number> {
    const payments = await this.host.db.payment.findMany({
      where: { methodId, deletedAt: undefined },
      select: { id: true, reference: true },
      orderBy: { id: 'asc' },
    });
    return this.search.setTexts(
      'PAYMENT',
      payments.map((payment) => ({
        entityId: payment.id,
        body: paymentSearchBody(payment.reference, name),
      })),
    );
  }
}
