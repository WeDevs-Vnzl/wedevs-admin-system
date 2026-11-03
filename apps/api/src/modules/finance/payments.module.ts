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
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { NotesModule } from '../commercial/notes.module';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { ReserveFileForAttachment } from '../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PlatformModule } from '../platform/platform.module';
import { TAGGABLE_TARGET_REGISTRY } from '../settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { TagsModule } from '../settings/tags.module';
import { FinanceProjector } from './application/finance-projector';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from './application/ports/invoice.repository.port';
import {
  PAYMENT_RECEIPT_FILES,
  PAYMENT_REFERENCES,
  type PaymentReceiptFilesPort,
  type PaymentReferencesPort,
} from './application/ports/payment-references.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from './application/ports/payment.repository.port';
import { RecomputeInvoice } from './application/use-cases/invoices/recompute-invoice.use-case';
import { InvoiceSupport } from './application/use-cases/invoices/invoice-support';
import {
  AllocatePayment,
  DeallocatePayment,
} from './application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from './application/use-cases/payments/create-payment.use-case';
import {
  DetectDuplicatePayment,
  GetClientCredit,
  GetInvoiceForPayment,
  GetPayment,
  ListPayments,
} from './application/use-cases/payments/payment-reads.use-case';
import { PaymentSupport } from './application/use-cases/payments/payment-support';
import { SetPaymentStatus } from './application/use-cases/payments/set-payment-status.use-case';
import {
  PAYMENT_LINK_SETTLEMENT,
  type PaymentLinkSettlementPort,
} from './application/ports/payment-link-settlement.port';
import { UpdatePayment } from './application/use-cases/payments/update-payment.use-case';
import {
  PlatformPaymentReceiptFiles,
  PrismaPaymentReferences,
} from './infrastructure/payment-references.adapter';
import {
  PaymentNoteTargetResolver,
  PaymentReceiptAccessResolver,
  PaymentTaggableResolver,
} from './infrastructure/payment-registry.resolvers';
import { PaymentExportSource } from './infrastructure/finance-export-sources';
import { PaymentReindexSource } from './infrastructure/finance-reindex-sources';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { PaymentsController } from './interface/http/payments.controller';
import { InvoicesModule } from './invoices.module';
import { ReadModelsModule } from './read-models.module';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';

/**
 * Finance → payments and allocations (PRD §8.6, HU-13, HU-14, §9.5, §9.6). A payment mutation writes the payment,
 * its allocations, the invoices' cached totals and installments' status, the facts, the account balance and the
 * client and project metrics in one `Serializable` unit of work, with every row locked once up front in the global
 * order. The invoice side comes from `InvoicesModule` (`RecomputeInvoice`, `InvoiceSupport.reindex`,
 * `INVOICE_REPOSITORY`). `PAYMENT_LINK_SETTLEMENT` is injected optionally: `integrations` binds it globally (DT-110) and
 * the payment link settlement is skipped where no such binding exists. From `onModuleInit` it registers the receipt claim in platform's `FileAccessRegistry`, the
 * `PAYMENT` taggable resolver in settings' tag registry and the `PAYMENT` note target. Not imported by
 * `AppModule`; package 6.1 wires it.
 */
@Module({
  imports: [
    PlatformModule,
    TagsModule,
    NotesModule,
    FinanceLookupsModule,
    FinanceCatalogsModule,
    ReadModelsModule,
    InvoicesModule,
  ],
  controllers: [PaymentsController],
  providers: [
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: PAYMENT_REFERENCES, useClass: PrismaPaymentReferences },
    {
      provide: PAYMENT_RECEIPT_FILES,
      useFactory: (reserve: ReserveFileForAttachment) => new PlatformPaymentReceiptFiles(reserve),
      inject: [ReserveFileForAttachment],
    },
    {
      provide: PaymentSupport,
      useFactory: (
        payments: PaymentRepository,
        invoices: InvoiceRepository,
        references: PaymentReferencesPort,
        receipts: PaymentReceiptFilesPort,
        invoiceSupport: InvoiceSupport,
        recompute: RecomputeInvoice,
        projector: FinanceProjector,
        search: SearchIndexPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        locks: RowLocksPort,
      ) =>
        new PaymentSupport(
          payments,
          invoices,
          references,
          receipts,
          invoiceSupport,
          recompute,
          projector,
          search,
          activityLog,
          clock,
          locks,
        ),
      inject: [
        PAYMENT_REPOSITORY,
        INVOICE_REPOSITORY,
        PAYMENT_REFERENCES,
        PAYMENT_RECEIPT_FILES,
        InvoiceSupport,
        RecomputeInvoice,
        FinanceProjector,
        SEARCH_INDEX,
        ACTIVITY_LOG,
        CLOCK,
        ROW_LOCKS,
      ],
    },
    ...[ListPayments, GetPayment, DetectDuplicatePayment].map((useCase) => ({
      provide: useCase,
      useFactory: (a: AuthorizationPort, p: PaymentRepository) => new useCase(a, p),
      inject: [AUTHORIZATION, PAYMENT_REPOSITORY],
    })),
    {
      provide: GetClientCredit,
      useFactory: (a: AuthorizationPort, p: PaymentRepository, r: PaymentReferencesPort) =>
        new GetClientCredit(a, p, r),
      inject: [AUTHORIZATION, PAYMENT_REPOSITORY, PAYMENT_REFERENCES],
    },
    {
      provide: GetInvoiceForPayment,
      useFactory: (a: AuthorizationPort, i: InvoiceRepository, r: PaymentReferencesPort) =>
        new GetInvoiceForPayment(a, i, r),
      inject: [AUTHORIZATION, INVOICE_REPOSITORY, PAYMENT_REFERENCES],
    },
    {
      provide: CreatePayment,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: PaymentSupport,
        sequence: SequencePort,
        ids: IdGeneratorPort,
      ) => new CreatePayment(a, uow, support, sequence, ids),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PaymentSupport, SEQUENCE, ID_GENERATOR],
    },
    {
      provide: AllocatePayment,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: PaymentSupport,
        ids: IdGeneratorPort,
        settlement?: PaymentLinkSettlementPort,
      ) => new AllocatePayment(a, uow, support, ids, settlement),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PaymentSupport,
        ID_GENERATOR,
        { token: PAYMENT_LINK_SETTLEMENT, optional: true },
      ],
    },
    {
      provide: SetPaymentStatus,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: PaymentSupport,
        settlement?: PaymentLinkSettlementPort,
      ) => new SetPaymentStatus(a, uow, support, settlement),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PaymentSupport,
        { token: PAYMENT_LINK_SETTLEMENT, optional: true },
      ],
    },
    {
      provide: UpdatePayment,
      useFactory: (a: AuthorizationPort, uow: UnitOfWorkPort, support: PaymentSupport) =>
        new UpdatePayment(a, uow, support),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PaymentSupport],
    },
    {
      provide: DeallocatePayment,
      useFactory: (
        a: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: PaymentSupport,
        settlement?: PaymentLinkSettlementPort,
      ) => new DeallocatePayment(a, uow, support, settlement),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PaymentSupport,
        { token: PAYMENT_LINK_SETTLEMENT, optional: true },
      ],
    },
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly fileAccess: FileAccessRegistry,
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    @Inject(NoteLinkTargetRegistry) private readonly noteTargets: NoteLinkTargetRegistry,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(SearchReindexRegistry) private readonly reindex: SearchReindexRegistry,
    @Inject(ExportSourceRegistry) private readonly exports: ExportSourceRegistry,
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(ListPayments) private readonly list: ListPayments,
  ) {}

  onModuleInit(): void {
    this.reindex.register(new PaymentReindexSource(this.host, this.payments));
    this.exports.register(new PaymentExportSource(this.list));
    this.fileAccess.register(new PaymentReceiptAccessResolver(this.payments));
    this.taggables.register(new PaymentTaggableResolver(this.payments));
    this.noteTargets.register(new PaymentNoteTargetResolver(this.payments));
  }
}
