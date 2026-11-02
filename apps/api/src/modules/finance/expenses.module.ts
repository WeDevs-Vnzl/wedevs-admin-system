import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import { ExportSourceRegistry } from '../../shared/application/ports/export-source.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import { SearchReindexRegistry } from '../../shared/application/ports/search-reindex.port';
import type { SequencePort } from '../../shared/application/ports/sequence.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { NotesModule } from '../commercial/notes.module';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { ReserveFileForAttachment } from '../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PlatformModule } from '../platform/platform.module';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { CurrencyCatalogQuery } from '../settings/application/currency-catalog.query';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { TagsModule } from '../settings/tags.module';
import { FinanceProjector } from './application/finance-projector';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalogPort,
} from './application/ports/currency-catalog.port';
import { EXCHANGE_RATE, type ExchangeRatePort } from './application/ports/exchange-rate.port';
import {
  RECURRING_EXPENSE_REPOSITORY,
  type RecurringExpenseRepository,
} from './application/ports/expense-recurring.repository.port';
import {
  EXPENSE_RECEIPT_FILES,
  EXPENSE_REFERENCES,
  type ExpenseReceiptFilesPort,
  type ExpenseReferencesPort,
} from './application/ports/expense-references.port';
import {
  EXPENSE_REPOSITORY,
  type ExpenseRepository,
} from './application/ports/expense.repository.port';
import { CreateExpense } from './application/use-cases/expenses/create-expense.use-case';
import { ExpenseSupport } from './application/use-cases/expenses/expense-support';
import { GenerateRecurringExpenses } from './application/use-cases/expenses/generate-recurring-expenses.use-case';
import { GetExpense, ListExpenses } from './application/use-cases/expenses/list-expenses.use-case';
import { MarkExpensePaid } from './application/use-cases/expenses/mark-expense-paid.use-case';
import {
  CreateRecurringExpense,
  GetRecurringExpense,
  ListRecurringExpenses,
  SetRecurringExpenseStatus,
  UpdateRecurringExpense,
} from './application/use-cases/expenses/recurring-expense.use-cases';
import { RecurringExpenseSupport } from './application/use-cases/expenses/recurring-expense-support';
import { UpdateExpense } from './application/use-cases/expenses/update-expense.use-case';
import { VoidExpense } from './application/use-cases/expenses/void-expense.use-case';
import {
  PlatformExpenseReceiptFiles,
  PrismaExpenseReferences,
} from './infrastructure/expense-references.adapter';
import {
  ExpenseNoteTargetResolver,
  ExpenseReceiptAccessResolver,
  ExpenseTaggableResolver,
} from './infrastructure/expense-registry.resolvers';
import { PrismaExpenseRecurringRepository } from './infrastructure/prisma-expense-recurring.repository';
import { ExpenseExportSource } from './infrastructure/finance-export-sources';
import { ExpenseReindexSource } from './infrastructure/finance-reindex-sources';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { SettingsCurrencyCatalogAdapter } from './infrastructure/settings-currency-catalog.adapter';
import { ExpensesController } from './interface/expenses/expenses.controller';
import { RecurringExpensesController } from './interface/expenses/recurring-expenses.controller';
import { ReadModelsModule } from './read-models.module';
import { RatesModule } from './rates.module';

/**
 * Finance → expenses and recurring expenses (PRD §8.8, HU-17, §9.7). A paid expense moves its account balance,
 * the project margin and the facts in one Serializable unit of work under the global lock order. From
 * `onModuleInit` it registers the receipt claim in platform's `FileAccessRegistry`, the `EXPENSE` taggable
 * resolver in settings' tag registry and the `EXPENSE` note target. `GenerateRecurringExpenses` is exported for
 * BE-5's `daily-maintenance`. Not imported by `AppModule`; package 6.1 wires it.
 */
@Module({
  imports: [
    PlatformModule,
    TagsModule,
    NotesModule,
    FinanceLookupsModule,
    FinanceCatalogsModule,
    ReadModelsModule,
    RatesModule,
  ],
  controllers: [ExpensesController, RecurringExpensesController],
  providers: [
    { provide: EXPENSE_REPOSITORY, useClass: PrismaExpenseRepository },
    { provide: RECURRING_EXPENSE_REPOSITORY, useClass: PrismaExpenseRecurringRepository },
    { provide: EXPENSE_REFERENCES, useClass: PrismaExpenseReferences },
    {
      provide: EXPENSE_RECEIPT_FILES,
      useFactory: (reserve: ReserveFileForAttachment) => new PlatformExpenseReceiptFiles(reserve),
      inject: [ReserveFileForAttachment],
    },
    {
      provide: CURRENCY_CATALOG,
      useFactory: (catalog: CurrencyCatalogQuery) => new SettingsCurrencyCatalogAdapter(catalog),
      inject: [CurrencyCatalogQuery],
    },
    {
      provide: ExpenseSupport,
      useFactory: (
        expenses: ExpenseRepository,
        references: ExpenseReferencesPort,
        receipts: ExpenseReceiptFilesPort,
        projector: FinanceProjector,
        search: SearchIndexPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        locks: RowLocksPort,
      ) =>
        new ExpenseSupport(
          expenses,
          references,
          receipts,
          projector,
          search,
          activityLog,
          clock,
          locks,
        ),
      inject: [
        EXPENSE_REPOSITORY,
        EXPENSE_REFERENCES,
        EXPENSE_RECEIPT_FILES,
        FinanceProjector,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        ROW_LOCKS,
      ],
    },
    {
      provide: RecurringExpenseSupport,
      useFactory: (
        recurring: RecurringExpenseRepository,
        references: ExpenseReferencesPort,
        rates: ExchangeRatePort,
        currencies: CurrencyCatalogPort,
        locks: RowLocksPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
      ) =>
        new RecurringExpenseSupport(
          recurring,
          references,
          rates,
          currencies,
          locks,
          activityLog,
          clock,
        ),
      inject: [
        RECURRING_EXPENSE_REPOSITORY,
        EXPENSE_REFERENCES,
        EXCHANGE_RATE,
        CURRENCY_CATALOG,
        ROW_LOCKS,
        ACTIVITY_LOG,
        CLOCK,
      ],
    },
    {
      provide: ListExpenses,
      useFactory: (a: AuthorizationPort, e: ExpenseRepository, c: ClockPort) =>
        new ListExpenses(a, e, c),
      inject: [AUTHORIZATION, EXPENSE_REPOSITORY, CLOCK],
    },
    {
      provide: GetExpense,
      useFactory: (a: AuthorizationPort, e: ExpenseRepository, c: ClockPort) =>
        new GetExpense(a, e, c),
      inject: [AUTHORIZATION, EXPENSE_REPOSITORY, CLOCK],
    },
    {
      provide: CreateExpense,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: ExpenseSupport,
        sequence: SequencePort,
        ids: IdGeneratorPort,
      ) => new CreateExpense(a, uow, support, sequence, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ExpenseSupport, SEQUENCE, ID_GENERATOR],
    },
    ...[UpdateExpense, MarkExpensePaid, VoidExpense].map((useCase) => ({
      provide: useCase,
      useFactory: (a: AuthorizationPort, uow: UnitOfWorkPort, support: ExpenseSupport) =>
        new useCase(a, uow, support),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ExpenseSupport],
    })),
    {
      provide: ListRecurringExpenses,
      useFactory: (a: AuthorizationPort, r: RecurringExpenseRepository) =>
        new ListRecurringExpenses(a, r),
      inject: [AUTHORIZATION, RECURRING_EXPENSE_REPOSITORY],
    },
    {
      provide: GetRecurringExpense,
      useFactory: (a: AuthorizationPort, s: RecurringExpenseSupport) =>
        new GetRecurringExpense(a, s),
      inject: [AUTHORIZATION, RecurringExpenseSupport],
    },
    {
      provide: CreateRecurringExpense,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        s: RecurringExpenseSupport,
        ids: IdGeneratorPort,
      ) => new CreateRecurringExpense(a, uow, s, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, RecurringExpenseSupport, ID_GENERATOR],
    },
    ...[UpdateRecurringExpense, SetRecurringExpenseStatus].map((useCase) => ({
      provide: useCase,
      useFactory: (a: AuthorizationPort, uow: UnitOfWorkPort, s: RecurringExpenseSupport) =>
        new useCase(a, uow, s),
      inject: [AUTHORIZATION, UNIT_OF_WORK, RecurringExpenseSupport],
    })),
    {
      provide: GenerateRecurringExpenses,
      useFactory: (
        uow: UnitOfWorkPort,
        recurring: RecurringExpenseRepository,
        expenses: ExpenseRepository,
        rates: ExchangeRatePort,
        sequence: SequencePort,
        locks: RowLocksPort,
        search: SearchIndexPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new GenerateRecurringExpenses(
          uow,
          recurring,
          expenses,
          rates,
          sequence,
          locks,
          search,
          activityLog,
          clock,
          ids,
        ),
      inject: [
        UNIT_OF_WORK,
        RECURRING_EXPENSE_REPOSITORY,
        EXPENSE_REPOSITORY,
        EXCHANGE_RATE,
        SEQUENCE,
        ROW_LOCKS,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
  ],
  exports: [GenerateRecurringExpenses, ListExpenses, ListRecurringExpenses],
})
export class ExpensesModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly fileAccess: FileAccessRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    @Inject(NoteLinkTargetRegistry) private readonly noteTargets: NoteLinkTargetRegistry,
    @Inject(EXPENSE_REPOSITORY) private readonly expenses: ExpenseRepository,
    @Inject(SearchReindexRegistry) private readonly reindex: SearchReindexRegistry,
    @Inject(ExportSourceRegistry) private readonly exports: ExportSourceRegistry,
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(ListExpenses) private readonly list: ListExpenses,
  ) {}

  onModuleInit(): void {
    this.reindex.register(new ExpenseReindexSource(this.host, this.expenses));
    this.exports.register(new ExpenseExportSource(this.list));
    this.fileAccess.register(new ExpenseReceiptAccessResolver(this.expenses));
    this.taggables.register(new ExpenseTaggableResolver(this.expenses));
    this.noteTargets.register(new ExpenseNoteTargetResolver(this.expenses));
  }
}
