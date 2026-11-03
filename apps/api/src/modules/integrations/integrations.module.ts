import { Global, Module } from '@nestjs/common';
import { IntegrationMappingModule } from '../settings/integration-mapping.module';
import { ExchangeModule } from './exchange.module';
import { PaymentLinksModule } from './payment-links.module';
import { IntegrationEventStoreModule, StripeModule } from './stripe.module';

/**
 * The two bindings every integrations feature module injects but does not import: `INTEGRATION_EVENT_STORE`
 * (global already) and `INTEGRATION_MAPPING` (exported by `StripeModule`, which binds it). Re-exporting them from
 * one global module gives `ExchangeModule` its tokens in the API and in the worker without touching its imports.
 */
@Global()
@Module({
  imports: [IntegrationEventStoreModule, StripeModule],
  exports: [IntegrationEventStoreModule, StripeModule],
})
export class IntegrationBindingsModule {}

/**
 * Aggregator of the `integrations` context for `AppModule` (package 4.1): the Stripe webhook, the payment-link
 * routes, the integration mapping routes and the Binance snapshot route. `BankPort` is deliberately unbound: no
 * consumer is wired until the bank adapter exists (DT-186).
 */
@Module({
  imports: [
    IntegrationBindingsModule,
    IntegrationMappingModule,
    PaymentLinksModule,
    ExchangeModule,
  ],
})
export class IntegrationsModule {}
