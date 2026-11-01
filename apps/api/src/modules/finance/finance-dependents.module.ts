import { Module } from '@nestjs/common';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import { ROW_LOCKS } from '../../shared/application/ports/tokens';
import { FinanceLookups } from '../commercial/application/finance-lookups';
import { CLIENT_FINANCE_DEPENDENTS } from '../commercial/application/ports/client-finance-dependents.port';
import { PROJECT_BILLING } from '../commercial/application/ports/project-billing.port';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from './application/ports/invoice.repository.port';
import { ProjectBillingApi } from './application/use-cases/billing/project-billing.api';
import { BillingModule } from './billing.module';
import { FinanceClientDependents } from './infrastructure/client-finance-dependents.adapter';
import { FinanceProjectBilling } from './infrastructure/finance-project-billing.adapter';
import { InvoicesModule } from './invoices.module';

/**
 * Binds `commercial`'s neutral finance ports to finance's exported application APIs (package 6.3; Q-BE2-1,
 * HU-08 CA3): `CLIENT_FINANCE_DEPENDENTS` over the invoice repository token `InvoicesModule` exports and
 * `PROJECT_BILLING` over `BillingModule`'s `ProjectBillingApi`. `commercial`'s clients and projects modules
 * import this module for the two tokens. It imports only finance's exporting modules and commercial's
 * `FinanceLookupsModule` (which imports nothing from `finance`), so no Nest module cycle closes:
 * `ClientsModule → FinanceDependentsModule → InvoicesModule → NotesModule` never returns to `ClientsModule`.
 */
@Module({
  imports: [InvoicesModule, BillingModule, FinanceLookupsModule],
  providers: [
    {
      provide: CLIENT_FINANCE_DEPENDENTS,
      useFactory: (invoices: InvoiceRepository) => new FinanceClientDependents(invoices),
      inject: [INVOICE_REPOSITORY],
    },
    {
      provide: PROJECT_BILLING,
      useFactory: (billing: ProjectBillingApi, lookups: FinanceLookups, locks: RowLocksPort) =>
        new FinanceProjectBilling(billing, lookups, locks),
      inject: [ProjectBillingApi, FinanceLookups, ROW_LOCKS],
    },
  ],
  exports: [CLIENT_FINANCE_DEPENDENTS, PROJECT_BILLING],
})
export class FinanceDependentsModule {}
