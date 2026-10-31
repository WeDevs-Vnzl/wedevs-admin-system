import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts.module';
import { BillingModule } from './billing.module';
import { ExpensesModule } from './expenses.module';
import { InvoicesModule } from './invoices.module';
import { PaymentsModule } from './payments.module';
import { RatesModule } from './rates.module';
import { ReadModelsModule } from './read-models.module';

/**
 * Finance aggregator (PRD §8.4-§8.8, §9): exchange rates, billing, accounts, expenses, invoices,
 * payments and allocations, and the read models they keep (`FinanceProjector`, `RecomputeAll`). Each
 * sub-module owns its providers and controllers; this module only composes them for `AppModule`.
 */
@Module({
  imports: [
    RatesModule,
    ReadModelsModule,
    BillingModule,
    AccountsModule,
    ExpensesModule,
    InvoicesModule,
    PaymentsModule,
  ],
})
export class FinanceModule {}
