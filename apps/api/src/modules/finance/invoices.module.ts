import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
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
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import { FinanceLookups } from '../commercial/application/finance-lookups';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { NotesModule } from '../commercial/notes.module';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { RESTORE_HANDLER_REGISTRY } from '../platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../platform/application/restore-handler.registry';
import { ReserveFileForAttachment } from '../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PlatformModule } from '../platform/platform.module';
import { TrashModule } from '../platform/trash.module';
import { CurrencyCatalogQuery } from '../settings/application/currency-catalog.query';
import { FiscalSettingsQuery } from '../settings/application/fiscal-settings.query';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { TagsModule } from '../settings/tags.module';
import { BillingModule } from './billing.module';
import { FinanceProjector } from './application/finance-projector';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalogPort,
} from './application/ports/currency-catalog.port';
import {
  INVOICE_FILES,
  INVOICE_FISCAL,
  INVOICE_REFERENCES,
  type InvoiceFilesPort,
  type InvoiceFiscalPort,
  type InvoiceReferencesPort,
} from './application/ports/invoice-references.port';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from './application/ports/invoice.repository.port';
import { RecomputeInstallmentStatus } from './application/use-cases/billing/recompute-installment-status';
import { ArchiveInvoice } from './application/use-cases/invoices/archive-invoice.use-case';
import { AttachInvoiceFile } from './application/use-cases/invoices/attach-invoice-file.use-case';
import { CreateInvoice } from './application/use-cases/invoices/create-invoice.use-case';
import {
  ListBillableInstallments,
  ListOpenInvoices,
} from './application/use-cases/invoices/invoice-wizard-reads.use-case';
import { InvoiceSupport } from './application/use-cases/invoices/invoice-support';
import { IssueDraft } from './application/use-cases/invoices/issue-draft.use-case';
import { GetInvoice, ListInvoices } from './application/use-cases/invoices/list-invoices.use-case';
import { MarkOverdueInvoices } from './application/use-cases/invoices/mark-overdue-invoices.use-case';
import { RecomputeInvoice } from './application/use-cases/invoices/recompute-invoice.use-case';
import { RestoreInvoice } from './application/use-cases/invoices/restore-invoice.use-case';
import { UpdateInvoice } from './application/use-cases/invoices/update-invoice.use-case';
import { VoidInvoice } from './application/use-cases/invoices/void-invoice.use-case';
import {
  CommercialInvoiceReferences,
  PlatformInvoiceFiles,
  SettingsInvoiceFiscal,
} from './infrastructure/invoice-references.adapter';
import {
  InvoiceFileAccessResolver,
  InvoiceNoteTargetResolver,
  InvoiceRestoreHandler,
  InvoiceTaggableResolver,
} from './infrastructure/invoice-registry.resolvers';
import { PrismaInvoiceRepository } from './infrastructure/prisma-invoice.repository';
import { SettingsCurrencyCatalogAdapter } from './infrastructure/settings-currency-catalog.adapter';
import { InvoicesController } from './interface/http/invoices.controller';
import { ReadModelsModule } from './read-models.module';

const AUTHORIZED = [AUTHORIZATION, UNIT_OF_WORK, InvoiceSupport];

/**
 * Finance → invoices (PRD §8.5, HU-11, HU-12, DT-44). An invoice mutation writes the invoice, its installments'
 * status, the facts and the client and project metrics in one `Serializable` unit of work under the global lock
 * order. From `onModuleInit` it registers the invoice file claim in platform's `FileAccessRegistry`, the
 * `INVOICE` taggable resolver in settings' tag registry, the `INVOICE` note target and the `INVOICE` restore
 * handler of the trash. `RecomputeInvoice` (payments) and `MarkOverdueInvoices` (BE-5's `daily-maintenance`)
 * are exported. Not imported by `AppModule`; package 6.1 wires it.
 */
@Module({
  imports: [
    PlatformModule,
    TrashModule,
    TagsModule,
    NotesModule,
    FinanceLookupsModule,
    FinanceCatalogsModule,
    ReadModelsModule,
    BillingModule,
  ],
  controllers: [InvoicesController],
  providers: [
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    {
      provide: INVOICE_REFERENCES,
      useFactory: (lookups: FinanceLookups) => new CommercialInvoiceReferences(lookups),
      inject: [FinanceLookups],
    },
    {
      provide: INVOICE_FISCAL,
      useFactory: (query: FiscalSettingsQuery) => new SettingsInvoiceFiscal(query),
      inject: [FiscalSettingsQuery],
    },
    {
      provide: INVOICE_FILES,
      useFactory: (reserve: ReserveFileForAttachment) => new PlatformInvoiceFiles(reserve),
      inject: [ReserveFileForAttachment],
    },
    {
      provide: CURRENCY_CATALOG,
      useFactory: (catalog: CurrencyCatalogQuery) => new SettingsCurrencyCatalogAdapter(catalog),
      inject: [CurrencyCatalogQuery],
    },
    {
      provide: InvoiceSupport,
      useFactory: (
        invoices: InvoiceRepository,
        references: InvoiceReferencesPort,
        fiscal: InvoiceFiscalPort,
        files: InvoiceFilesPort,
        currencies: CurrencyCatalogPort,
        projector: FinanceProjector,
        installments: RecomputeInstallmentStatus,
        search: SearchIndexPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        locks: RowLocksPort,
      ) =>
        new InvoiceSupport(
          invoices,
          references,
          fiscal,
          files,
          currencies,
          projector,
          installments,
          search,
          activityLog,
          clock,
          locks,
        ),
      inject: [
        INVOICE_REPOSITORY,
        INVOICE_REFERENCES,
        INVOICE_FISCAL,
        INVOICE_FILES,
        CURRENCY_CATALOG,
        FinanceProjector,
        RecomputeInstallmentStatus,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        ROW_LOCKS,
      ],
    },
    {
      provide: ListInvoices,
      useFactory: (a: AuthorizationPort, i: InvoiceRepository, c: ClockPort) =>
        new ListInvoices(a, i, c),
      inject: [AUTHORIZATION, INVOICE_REPOSITORY, CLOCK],
    },
    {
      provide: GetInvoice,
      useFactory: (a: AuthorizationPort, i: InvoiceRepository, c: ClockPort) =>
        new GetInvoice(a, i, c),
      inject: [AUTHORIZATION, INVOICE_REPOSITORY, CLOCK],
    },
    {
      provide: CreateInvoice,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: InvoiceSupport,
        sequence: SequencePort,
        ids: IdGeneratorPort,
      ) => new CreateInvoice(a, uow, support, sequence, ids),
      inject: [...AUTHORIZED, SEQUENCE, ID_GENERATOR],
    },
    {
      provide: UpdateInvoice,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: InvoiceSupport,
        ids: IdGeneratorPort,
      ) => new UpdateInvoice(a, uow, support, ids),
      inject: [...AUTHORIZED, ID_GENERATOR],
    },
    ...[IssueDraft, VoidInvoice, ArchiveInvoice, RestoreInvoice, AttachInvoiceFile].map(
      (useCase) => ({
        provide: useCase,
        useFactory: (a: AuthorizationPort, uow: UnitOfWorkPort, support: InvoiceSupport) =>
          new useCase(a, uow, support),
        inject: AUTHORIZED,
      }),
    ),
    {
      provide: ListBillableInstallments,
      useFactory: (a: AuthorizationPort, i: InvoiceRepository, r: InvoiceReferencesPort) =>
        new ListBillableInstallments(a, i, r),
      inject: [AUTHORIZATION, INVOICE_REPOSITORY, INVOICE_REFERENCES],
    },
    {
      provide: ListOpenInvoices,
      useFactory: (a: AuthorizationPort, i: InvoiceRepository, r: InvoiceReferencesPort) =>
        new ListOpenInvoices(a, i, r),
      inject: [AUTHORIZATION, INVOICE_REPOSITORY, INVOICE_REFERENCES],
    },
    {
      provide: RecomputeInvoice,
      useFactory: (support: InvoiceSupport) => new RecomputeInvoice(support),
      inject: [InvoiceSupport],
    },
    {
      provide: MarkOverdueInvoices,
      useFactory: (
        uow: UnitOfWorkPort,
        invoices: InvoiceRepository,
        support: InvoiceSupport,
        clock: ClockPort,
      ) => new MarkOverdueInvoices(uow, invoices, support, clock),
      inject: [UNIT_OF_WORK, INVOICE_REPOSITORY, InvoiceSupport, CLOCK],
    },
  ],
  exports: [RecomputeInvoice, MarkOverdueInvoices],
})
export class InvoicesModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly fileAccess: FileAccessRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    @Inject(NoteLinkTargetRegistry) private readonly noteTargets: NoteLinkTargetRegistry,
    @Inject(RESTORE_HANDLER_REGISTRY) private readonly restoreHandlers: RestoreHandlerRegistry,
    @Inject(INVOICE_REPOSITORY) private readonly invoices: InvoiceRepository,
    @Inject(RestoreInvoice) private readonly restoreInvoice: RestoreInvoice,
  ) {}

  onModuleInit(): void {
    this.fileAccess.register(new InvoiceFileAccessResolver(this.invoices));
    this.taggables.register(new InvoiceTaggableResolver(this.invoices));
    this.noteTargets.register(new InvoiceNoteTargetResolver(this.invoices));
    this.restoreHandlers.register(new InvoiceRestoreHandler(this.restoreInvoice));
  }
}
