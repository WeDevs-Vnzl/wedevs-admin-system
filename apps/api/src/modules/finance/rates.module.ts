import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { CurrencyCatalogQuery } from '../settings/application/currency-catalog.query';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalogPort,
} from './application/ports/currency-catalog.port';
import { EXCHANGE_RATE, type ExchangeRatePort } from './application/ports/exchange-rate.port';
import {
  EXCHANGE_RATE_REPOSITORY,
  type ExchangeRateRepository,
} from './application/ports/exchange-rate.repository.port';
import { GetRateFor } from './application/use-cases/rates/get-rate-for.use-case';
import { ImportRatesCsv } from './application/use-cases/rates/import-rates-csv.use-case';
import { ListExchangeRates } from './application/use-cases/rates/list-exchange-rates.use-case';
import { LoadDailyRates } from './application/use-cases/rates/load-daily-rates.use-case';
import { UpsertExchangeRate } from './application/use-cases/rates/upsert-exchange-rate.use-case';
import { ManualRateSource } from './infrastructure/manual-rate-source';
import { PrismaExchangeRateRepository } from './infrastructure/prisma-exchange-rate.repository';
import { SettingsCurrencyCatalogAdapter } from './infrastructure/settings-currency-catalog.adapter';
import { ExchangeRatesController } from './interface/http/exchange-rates.controller';

/**
 * Finance → exchange rates (PRD §8.15, §9.2, DT-67): the rates table and the `ExchangeRatePort` every finance
 * slice reads its USD snapshots from. `ExchangeRatePort` is exported for the other finance modules and BE-5.
 * Not imported by `AppModule` here; package 6.1 wires it.
 */
@Module({
  imports: [FinanceCatalogsModule],
  controllers: [ExchangeRatesController],
  providers: [
    {
      provide: CURRENCY_CATALOG,
      useFactory: (catalog: CurrencyCatalogQuery) => new SettingsCurrencyCatalogAdapter(catalog),
      inject: [CurrencyCatalogQuery],
    },
    { provide: EXCHANGE_RATE_REPOSITORY, useClass: PrismaExchangeRateRepository },
    {
      provide: EXCHANGE_RATE,
      useFactory: (rates: ExchangeRateRepository) => new ManualRateSource(rates),
      inject: [EXCHANGE_RATE_REPOSITORY],
    },
    {
      provide: GetRateFor,
      useFactory: (rates: ExchangeRatePort) => new GetRateFor(rates),
      inject: [EXCHANGE_RATE],
    },
    {
      provide: ListExchangeRates,
      useFactory: (authorization: AuthorizationPort, rates: ExchangeRateRepository) =>
        new ListExchangeRates(authorization, rates),
      inject: [AUTHORIZATION, EXCHANGE_RATE_REPOSITORY],
    },
    ...[UpsertExchangeRate, LoadDailyRates, ImportRatesCsv].map((useCase) => ({
      provide: useCase,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        rates: ExchangeRateRepository,
        activityLog: ActivityLogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        currencies: CurrencyCatalogPort,
      ) => new useCase(authorization, uow, rates, activityLog, clock, ids, currencies),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        EXCHANGE_RATE_REPOSITORY,
        ACTIVITY_LOG,
        CLOCK,
        ID_GENERATOR,
        CURRENCY_CATALOG,
      ],
    })),
  ],
  exports: [EXCHANGE_RATE],
})
export class RatesModule {}
