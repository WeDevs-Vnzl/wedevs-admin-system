import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import { SearchReindexRegistry } from '../../shared/application/ports/search-reindex.port';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  SEARCH_INDEX,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { CurrencyCatalogQuery } from '../settings/application/currency-catalog.query';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { FinanceProjector } from './application/finance-projector';
import {
  ACCOUNT_PARTNERS,
  type AccountPartnersPort,
} from './application/ports/account-partners.port';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from './application/ports/account.repository.port';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalogPort,
} from './application/ports/currency-catalog.port';
import { EXCHANGE_RATE, type ExchangeRatePort } from './application/ports/exchange-rate.port';
import { FINANCE_SOURCES, type FinanceSourcesPort } from './application/ports/finance-sources.port';
import { CreateAccount } from './application/use-cases/accounts/create-account.use-case';
import { CreateMovement } from './application/use-cases/accounts/create-movement.use-case';
import { CreateTransfer } from './application/use-cases/accounts/create-transfer.use-case';
import { GetAccount } from './application/use-cases/accounts/get-account.use-case';
import { GetAccountBalance } from './application/use-cases/accounts/get-account-balance.use-case';
import { GetAccountLedger } from './application/use-cases/accounts/get-account-ledger.use-case';
import { ListAccountPartners } from './application/use-cases/accounts/list-account-partners.use-case';
import { ListAccounts } from './application/use-cases/accounts/list-accounts.use-case';
import { ReconcileAccount } from './application/use-cases/accounts/reconcile-account.use-case';
import { UpdateAccount } from './application/use-cases/accounts/update-account.use-case';
import { AccountPartnersAdapter } from './infrastructure/account-partners.adapter';
import { AccountReindexSource } from './infrastructure/finance-reindex-sources';
import { PrismaAccountRepository } from './infrastructure/prisma-account.repository';
import { PrismaFinanceSources } from './infrastructure/prisma-finance-sources';
import { SettingsCurrencyCatalogAdapter } from './infrastructure/settings-currency-catalog.adapter';
import { AccountsController, TransfersController } from './interface/accounts/accounts.controller';
import { RatesModule } from './rates.module';
import { ReadModelsModule } from './read-models.module';

/**
 * Finance → accounts (PRD §8.7, §9.7, §12 `accounts`): accounts, the ledger over `account_ledger_v`,
 * transfers, manual movements, reconciliation and partners. Every money mutation runs in one `Serializable`
 * unit of work that locks its `Account` rows up front (global lock order) and projects the facts and the
 * cached balances through `FinanceProjector`. Module-scoped like `RatesModule`; package 6.1 wires it.
 */
@Module({
  imports: [FinanceCatalogsModule, FinanceLookupsModule, RatesModule, ReadModelsModule],
  controllers: [AccountsController, TransfersController],
  providers: [
    {
      provide: CURRENCY_CATALOG,
      useFactory: (catalog: CurrencyCatalogQuery) => new SettingsCurrencyCatalogAdapter(catalog),
      inject: [CurrencyCatalogQuery],
    },
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    { provide: FINANCE_SOURCES, useClass: PrismaFinanceSources },
    { provide: ACCOUNT_PARTNERS, useClass: AccountPartnersAdapter },
    {
      provide: CreateAccount,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        accounts: AccountRepository,
        projector: FinanceProjector,
        search: SearchIndexPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        currencies: CurrencyCatalogPort,
        rates: ExchangeRatePort,
      ) =>
        new CreateAccount(
          authorization,
          uow,
          accounts,
          projector,
          search,
          activity,
          clock,
          ids,
          currencies,
          rates,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        ACCOUNT_REPOSITORY,
        FinanceProjector,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
        CURRENCY_CATALOG,
        EXCHANGE_RATE,
      ],
    },
    {
      provide: UpdateAccount,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        accounts: AccountRepository,
        projector: FinanceProjector,
        search: SearchIndexPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        currencies: CurrencyCatalogPort,
        rates: ExchangeRatePort,
      ) =>
        new UpdateAccount(
          authorization,
          uow,
          locks,
          accounts,
          projector,
          search,
          activity,
          clock,
          currencies,
          rates,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        ROW_LOCKS,
        ACCOUNT_REPOSITORY,
        FinanceProjector,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        CURRENCY_CATALOG,
        EXCHANGE_RATE,
      ],
    },
    ...[GetAccount, ListAccounts].map((useCase) => ({
      provide: useCase,
      useFactory: (
        authorization: AuthorizationPort,
        accounts: AccountRepository,
        rates: ExchangeRatePort,
        clock: ClockPort,
      ) => new useCase(authorization, accounts, rates, clock),
      inject: [AUTHORIZATION, ACCOUNT_REPOSITORY, EXCHANGE_RATE, CLOCK],
    })),
    {
      provide: GetAccountLedger,
      useFactory: (authorization: AuthorizationPort, accounts: AccountRepository) =>
        new GetAccountLedger(authorization, accounts),
      inject: [AUTHORIZATION, ACCOUNT_REPOSITORY],
    },
    {
      provide: GetAccountBalance,
      useFactory: (
        authorization: AuthorizationPort,
        accounts: AccountRepository,
        sources: FinanceSourcesPort,
        rates: ExchangeRatePort,
        clock: ClockPort,
      ) => new GetAccountBalance(authorization, accounts, sources, rates, clock),
      inject: [AUTHORIZATION, ACCOUNT_REPOSITORY, FINANCE_SOURCES, EXCHANGE_RATE, CLOCK],
    },
    {
      provide: ReconcileAccount,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        accounts: AccountRepository,
        sources: FinanceSourcesPort,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new ReconcileAccount(authorization, uow, locks, accounts, sources, activity, clock, ids),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        ROW_LOCKS,
        ACCOUNT_REPOSITORY,
        FINANCE_SOURCES,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: CreateTransfer,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        accounts: AccountRepository,
        projector: FinanceProjector,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new CreateTransfer(authorization, uow, locks, accounts, projector, activity, clock, ids),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        ROW_LOCKS,
        ACCOUNT_REPOSITORY,
        FinanceProjector,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: CreateMovement,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        accounts: AccountRepository,
        partners: AccountPartnersPort,
        projector: FinanceProjector,
        activity: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new CreateMovement(
          authorization,
          uow,
          locks,
          accounts,
          partners,
          projector,
          activity,
          clock,
          ids,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        ROW_LOCKS,
        ACCOUNT_REPOSITORY,
        ACCOUNT_PARTNERS,
        FinanceProjector,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ListAccountPartners,
      useFactory: (authorization: AuthorizationPort, partners: AccountPartnersPort) =>
        new ListAccountPartners(authorization, partners),
      inject: [AUTHORIZATION, ACCOUNT_PARTNERS],
    },
  ],
  exports: [ListAccounts],
})
export class AccountsModule implements OnModuleInit {
  constructor(
    @Inject(SearchReindexRegistry) private readonly reindex: SearchReindexRegistry,
    @Inject(TransactionHost) private readonly host: TransactionHost,
  ) {}

  onModuleInit(): void {
    this.reindex.register(new AccountReindexSource(this.host));
  }
}
