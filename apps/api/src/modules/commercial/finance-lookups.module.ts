import { Module } from '@nestjs/common';
import {
  FINANCE_LOOKUPS_SOURCE,
  FinanceLookups,
  type FinanceLookupsSource,
} from './application/finance-lookups';
import { PrismaFinanceLookups } from './infrastructure/prisma-finance-lookups';

/**
 * Commercial's lookups for finance (boundary rule e). Exports `FinanceLookups`, the one token finance
 * injects. Imports nothing from `finance` (and `TransactionHost` is global), so finance importing this module
 * cannot close a module cycle.
 */
@Module({
  providers: [
    { provide: FINANCE_LOOKUPS_SOURCE, useClass: PrismaFinanceLookups },
    {
      provide: FinanceLookups,
      useFactory: (source: FinanceLookupsSource) => new FinanceLookups(source),
      inject: [FINANCE_LOOKUPS_SOURCE],
    },
  ],
  exports: [FinanceLookups],
})
export class FinanceLookupsModule {}
