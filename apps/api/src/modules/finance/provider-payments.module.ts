import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../shared/application/ports/sequence.port';
import {
  ACTIVITY_LOG,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { FinanceProjector } from './application/finance-projector';
import { EXCHANGE_RATE, type ExchangeRatePort } from './application/ports/exchange-rate.port';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from './application/ports/invoice.repository.port';
import {
  PAYMENT_LINK_SETTLEMENT,
  PROVIDER_PAYMENT_REFERENCE,
  type PaymentLinkSettlementPort,
  type ProviderPaymentReferencePort,
} from './application/ports/payment-link-settlement.port';
import {
  PROVIDER_EVENT_LOG,
  type ProviderEventLogPort,
} from './application/ports/provider-event-log.port';
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
import { InvoiceSupport } from './application/use-cases/invoices/invoice-support';
import { RecomputeInvoice } from './application/use-cases/invoices/recompute-invoice.use-case';
import { PaymentSupport } from './application/use-cases/payments/payment-support';
import { RecordProviderPayment } from './application/use-cases/payments/record-provider-payment.use-case';
import { PrismaPaymentReferences } from './infrastructure/payment-references.adapter';
import { PrismaProviderPaymentReference } from './infrastructure/prisma-payment-link-settlement.adapter';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { InvoicesModule } from './invoices.module';
import { RatesModule } from './rates.module';
import { ReadModelsModule } from './read-models.module';

/** A provider payment never carries a receipt file: claiming one is a programming error. */
const NO_RECEIPTS: PaymentReceiptFilesPort = {
  reserve: async () => {
    throw new Error('A payment recorded from a provider event has no receipt');
  },
};

/**
 * Finance → payments written from a provider event (A6, DT-183, DT-199). Exports `RecordProviderPayment`, which
 * `integrations` reaches through an adapter of its `ProviderPaymentRecordingPort`. It builds its own
 * `PaymentSupport` over the same adapters as `PaymentsModule` (which exports nothing). Finance imports nothing
 * from `integrations` (DT-110): `PROVIDER_EVENT_LOG` and `PAYMENT_LINK_SETTLEMENT` are declared here and bound,
 * globally, by `integrations`. Not imported by `AppModule`.
 */
@Module({
  imports: [
    FinanceLookupsModule,
    FinanceCatalogsModule,
    ReadModelsModule,
    InvoicesModule,
    RatesModule,
  ],
  providers: [
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: PAYMENT_REFERENCES, useClass: PrismaPaymentReferences },
    { provide: PAYMENT_RECEIPT_FILES, useValue: NO_RECEIPTS },
    { provide: PROVIDER_PAYMENT_REFERENCE, useClass: PrismaProviderPaymentReference },
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
    {
      provide: RecordProviderPayment,
      useFactory: (
        uow: UnitOfWorkPort,
        support: PaymentSupport,
        sequence: SequencePort,
        ids: IdGeneratorPort,
        events: ProviderEventLogPort,
        rates: ExchangeRatePort,
        links: PaymentLinkSettlementPort,
        references: ProviderPaymentReferencePort,
      ) => new RecordProviderPayment(uow, support, sequence, ids, events, rates, links, references),
      inject: [
        UNIT_OF_WORK,
        PaymentSupport,
        SEQUENCE,
        ID_GENERATOR,
        PROVIDER_EVENT_LOG,
        EXCHANGE_RATE,
        PAYMENT_LINK_SETTLEMENT,
        PROVIDER_PAYMENT_REFERENCE,
      ],
    },
  ],
  exports: [RecordProviderPayment],
})
export class ProviderPaymentsModule {}
