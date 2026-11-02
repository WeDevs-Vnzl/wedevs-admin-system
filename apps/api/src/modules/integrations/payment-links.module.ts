import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  INVOICE_FOR_LINK,
  type InvoiceForLinkPort,
} from './application/ports/invoice-for-link.port';
import {
  PAYMENT_LINK_REPOSITORY,
  type PaymentLinkRepository,
} from './application/ports/payment-link.repository.port';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './application/ports/payment-provider.port';
import { CreateInvoicePaymentLink } from './application/use-cases/payment-links/create-invoice-payment-link.use-case';
import { DeactivateInvoicePaymentLink } from './application/use-cases/payment-links/deactivate-invoice-payment-link.use-case';
import { DeactivatePaymentLinksBeyondBalance } from './application/use-cases/payment-links/deactivate-payment-links-beyond-balance.use-case';
import { ListInvoicePaymentLinks } from './application/use-cases/payment-links/list-invoice-payment-links.use-case';
import { PaymentLinksController } from './interface/http/payment-links.controller';
import { PaymentLinkCoreModule, StripeProviderModule } from './stripe.module';

/**
 * Stripe payment links of an invoice (choice 1, DT-196): the three routes and the four use cases. Self-contained
 * so a spec can load it alone; `AppModule` aggregates it through `integrations.module.ts` (4.1). With Stripe
 * unconfigured the routes answer 404. `DeactivatePaymentLinksBeyondBalance` is exported for the daily step (3.2).
 */
@Module({
  imports: [StripeProviderModule, PaymentLinkCoreModule],
  controllers: [PaymentLinksController],
  providers: [
    {
      provide: ListInvoicePaymentLinks,
      useFactory: (
        authorization: AuthorizationPort,
        invoices: InvoiceForLinkPort,
        links: PaymentLinkRepository,
      ) => new ListInvoicePaymentLinks(authorization, invoices, links),
      inject: [AUTHORIZATION, INVOICE_FOR_LINK, PAYMENT_LINK_REPOSITORY],
    },
    {
      provide: CreateInvoicePaymentLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        invoices: InvoiceForLinkPort,
        links: PaymentLinkRepository,
        provider: PaymentProviderPort,
        locks: RowLocksPort,
        activityLog: ActivityLogPort,
        ids: IdGeneratorPort,
        clock: ClockPort,
      ) =>
        new CreateInvoicePaymentLink(
          authorization,
          uow,
          invoices,
          links,
          provider,
          locks,
          activityLog,
          ids,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        INVOICE_FOR_LINK,
        PAYMENT_LINK_REPOSITORY,
        PAYMENT_PROVIDER,
        ROW_LOCKS,
        ACTIVITY_LOG,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: DeactivateInvoicePaymentLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        links: PaymentLinkRepository,
        provider: PaymentProviderPort,
        locks: RowLocksPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
      ) =>
        new DeactivateInvoicePaymentLink(
          authorization,
          uow,
          links,
          provider,
          locks,
          activityLog,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        PAYMENT_LINK_REPOSITORY,
        PAYMENT_PROVIDER,
        ROW_LOCKS,
        ACTIVITY_LOG,
        CLOCK,
      ],
    },
    {
      provide: DeactivatePaymentLinksBeyondBalance,
      useFactory: (
        uow: UnitOfWorkPort,
        invoices: InvoiceForLinkPort,
        links: PaymentLinkRepository,
        provider: PaymentProviderPort,
        locks: RowLocksPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
      ) =>
        new DeactivatePaymentLinksBeyondBalance(
          uow,
          invoices,
          links,
          provider,
          locks,
          activityLog,
          clock,
        ),
      inject: [
        UNIT_OF_WORK,
        INVOICE_FOR_LINK,
        PAYMENT_LINK_REPOSITORY,
        PAYMENT_PROVIDER,
        ROW_LOCKS,
        ACTIVITY_LOG,
        CLOCK,
      ],
    },
  ],
  exports: [DeactivatePaymentLinksBeyondBalance],
})
export class PaymentLinksModule {}
