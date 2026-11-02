import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import { integrationsOf, type AppConfig } from '../../config/env.schema';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { CLOCK, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../shared/domain';
import { InvoicesModule } from '../finance/invoices.module';
import { ProviderPaymentsModule } from '../finance/provider-payments.module';
import { IntegrationMappingModule } from '../settings/integration-mapping.module';
import {
  INTEGRATION_EVENT_STORE,
  type IntegrationEventStore,
} from './application/ports/integration-event-store.port';
import {
  INTEGRATION_MAPPING,
  type IntegrationMappingPort,
} from './application/ports/integration-mapping.port';
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
import { HandleStripeWebhook } from './application/use-cases/stripe/handle-stripe-webhook.use-case';
import {
  PROVIDER_PAYMENT_RECORDING,
  type ProviderPaymentRecordingPort,
} from './application/use-cases/stripe/provider-payment-recording.port';
import { FinanceInvoiceForLink } from './infrastructure/finance-invoice-for-link.adapter';
import { FinanceProviderPaymentRecorder } from './infrastructure/finance-provider-payment-recorder.adapter';
import { PrismaIntegrationEventStore } from './infrastructure/prisma-integration-event.store';
import { PrismaPaymentLinkRepository } from './infrastructure/prisma-payment-link.repository';
import { SettingsIntegrationMapping } from './infrastructure/settings-integration-mapping.adapter';
import { createStripePaymentProvider } from './infrastructure/stripe/stripe-payment-provider';
import { STRIPE_ENABLED } from './interface/http/payment-links.availability';
import { StripeWebhookController } from './interface/http/webhooks.controller';

/**
 * The event store is global because `ProviderPaymentsModule` (finance) injects `INTEGRATION_EVENT_STORE` and
 * cannot import an `integrations` module (DT-110): finance declares the dependency, whoever wires the context
 * satisfies it. One binding, one Prisma adapter.
 */
@Global()
@Module({
  providers: [{ provide: INTEGRATION_EVENT_STORE, useClass: PrismaIntegrationEventStore }],
  exports: [INTEGRATION_EVENT_STORE],
})
export class IntegrationEventStoreModule {}

/** Stands in for the provider when Stripe is not configured; every route is already off (choice 3). */
class UnconfiguredPaymentProvider implements PaymentProviderPort {
  verifyEvent(): never {
    throw new NotFoundError();
  }
  retrievePayment(): never {
    throw new NotFoundError();
  }
  createPaymentLink(): never {
    throw new NotFoundError();
  }
  deactivatePaymentLink(): never {
    throw new NotFoundError();
  }
}

/**
 * `PAYMENT_PROVIDER` and the `STRIPE_ENABLED` switch (choice 3, DT-193). The adapter is built from the Stripe pair
 * of `envSchema`; the Checkout return URL is the app's own `APP_URL`, no new variable. Both bindings are exported
 * for the webhook, the link routes and (3.2) the daily job.
 */
@Module({
  providers: [
    {
      provide: STRIPE_ENABLED,
      useFactory: (config: AppConfig): boolean => integrationsOf(config).stripe !== null,
      inject: [APP_CONFIG],
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: AppConfig): PaymentProviderPort => {
        const { stripe } = integrationsOf(config);
        if (!stripe) return new UnconfiguredPaymentProvider();
        return createStripePaymentProvider({
          apiKey: stripe.secretKey,
          webhookSecret: stripe.webhookSecret,
          returnUrl: config.APP_URL,
        });
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [STRIPE_ENABLED, PAYMENT_PROVIDER],
})
export class StripeProviderModule {}

/** The link repository and the invoice read the webhook and the link routes share (DT-110). */
@Module({
  imports: [InvoicesModule],
  providers: [
    { provide: PAYMENT_LINK_REPOSITORY, useClass: PrismaPaymentLinkRepository },
    { provide: INVOICE_FOR_LINK, useClass: FinanceInvoiceForLink },
  ],
  exports: [PAYMENT_LINK_REPOSITORY, INVOICE_FOR_LINK],
})
export class PaymentLinkCoreModule {}

/**
 * `POST /api/v1/webhooks/stripe` (DT-183, A6): the only `@Public()` route of the batch. Verifies the signature,
 * resolves the payment and hands it to finance's `RecordProviderPayment` through an adapter. Self-contained so a
 * spec can load it alone; `AppModule` aggregates it through `integrations.module.ts` (4.1). With Stripe
 * unconfigured the route answers 404.
 */
@Module({
  imports: [
    IntegrationEventStoreModule,
    StripeProviderModule,
    PaymentLinkCoreModule,
    ProviderPaymentsModule,
    IntegrationMappingModule,
  ],
  controllers: [StripeWebhookController],
  providers: [
    { provide: INTEGRATION_MAPPING, useClass: SettingsIntegrationMapping },
    { provide: PROVIDER_PAYMENT_RECORDING, useClass: FinanceProviderPaymentRecorder },
    {
      provide: HandleStripeWebhook,
      useFactory: (
        uow: UnitOfWorkPort,
        provider: PaymentProviderPort,
        events: IntegrationEventStore,
        mapping: IntegrationMappingPort,
        links: PaymentLinkRepository,
        invoices: InvoiceForLinkPort,
        recording: ProviderPaymentRecordingPort,
        clock: ClockPort,
      ) =>
        new HandleStripeWebhook(uow, provider, events, mapping, links, invoices, recording, clock),
      inject: [
        UNIT_OF_WORK,
        PAYMENT_PROVIDER,
        INTEGRATION_EVENT_STORE,
        INTEGRATION_MAPPING,
        PAYMENT_LINK_REPOSITORY,
        INVOICE_FOR_LINK,
        PROVIDER_PAYMENT_RECORDING,
        CLOCK,
      ],
    },
  ],
  exports: [INTEGRATION_MAPPING],
})
export class StripeModule {}
