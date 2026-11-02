import { Inject, Injectable, Module } from '@nestjs/common';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import { SEARCH_INDEX } from '../../shared/application/ports/tokens';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { FinancePaymentMethodSearchDependents } from './infrastructure/payment-method-search-dependents.adapter';

/** The adapter as a Nest provider; settings binds `PAYMENT_METHOD_SEARCH_DEPENDENTS` to it with `useExisting`. */
@Injectable()
export class PaymentMethodSearchDependents extends FinancePaymentMethodSearchDependents {
  constructor(
    @Inject(TransactionHost) host: TransactionHost,
    @Inject(SEARCH_INDEX) search: SearchIndexPort,
  ) {
    super(host, search);
  }
}

/**
 * Exports the adapter behind settings' `PAYMENT_METHOD_SEARCH_DEPENDENTS` (DT-166). It imports nothing from
 * `settings`: finance consumes `settings` (`FinanceCatalogsModule`, `TagsModule`), so a back edge would be a
 * Nest module cycle. Same shape as `DocumentUsageModule` (DT-110).
 */
@Module({
  providers: [PaymentMethodSearchDependents],
  exports: [PaymentMethodSearchDependents],
})
export class PaymentSearchDependentsModule {}
