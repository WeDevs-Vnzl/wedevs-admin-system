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
import { FinanceLookups } from '../commercial/application/finance-lookups';
import { FinanceLookupsModule } from '../commercial/finance-lookups.module';
import { CurrencyCatalogQuery } from '../settings/application/currency-catalog.query';
import { FinanceCatalogsModule } from '../settings/finance-catalogs.module';
import { FinanceProjector } from './application/finance-projector';
import {
  BILLING_PROJECTS,
  type BillingProjectsPort,
} from './application/ports/billing-projects.port';
import {
  BILLING_REPOSITORY,
  type BillingRepository,
} from './application/ports/billing.repository.port';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalogPort,
} from './application/ports/currency-catalog.port';
import { EXCHANGE_RATE, type ExchangeRatePort } from './application/ports/exchange-rate.port';
import { ApplyInstallmentTemplate } from './application/use-cases/billing/apply-installment-template.use-case';
import { BillingTransaction } from './application/use-cases/billing/billing-transaction';
import { CancelInstallment } from './application/use-cases/billing/cancel-installment.use-case';
import { CreateInstallment } from './application/use-cases/billing/create-installment.use-case';
import { CreateRecurringCharge } from './application/use-cases/billing/create-recurring-charge.use-case';
import { GenerateMissingPeriods } from './application/use-cases/billing/generate-missing-periods.use-case';
import { GenerateRecurringInstallments } from './application/use-cases/billing/generate-recurring-installments.use-case';
import { GetBillingPage } from './application/use-cases/billing/get-billing-page.use-case';
import { ProjectBillingApi } from './application/use-cases/billing/project-billing.api';
import { RecomputeInstallmentStatus } from './application/use-cases/billing/recompute-installment-status';
import { RecurringGenerator } from './application/use-cases/billing/recurring-generator';
import { SetRecurringChargeStatus } from './application/use-cases/billing/set-recurring-charge-status.use-case';
import { UpdateInstallment } from './application/use-cases/billing/update-installment.use-case';
import { UpdateRecurringCharge } from './application/use-cases/billing/update-recurring-charge.use-case';
import { UpsertBillingPlan } from './application/use-cases/billing/upsert-billing-plan.use-case';
import { CommercialBillingProjectsAdapter } from './infrastructure/billing-projects.adapter';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { SettingsCurrencyCatalogAdapter } from './infrastructure/settings-currency-catalog.adapter';
import { BillingController } from './interface/billing/billing.controller';
import { RatesModule } from './rates.module';
import { ReadModelsModule } from './read-models.module';

/**
 * Finance → billing (PRD §8.4, HU-09, HU-10): billing plan, installments, recurring charges and the steps
 * that generate their periods. Exports `RecomputeInstallmentStatus` (invoices and payments call it),
 * `ProjectBillingApi` (package 6.3 rebinds `commercial`'s `ProjectBillingPort` to it) and
 * `GenerateRecurringInstallments` (the `daily-maintenance` step BE-5 schedules). Not imported by
 * `AppModule` here; package 6.1 wires it.
 */
@Module({
  imports: [FinanceCatalogsModule, FinanceLookupsModule, RatesModule, ReadModelsModule],
  controllers: [BillingController],
  providers: [
    {
      provide: CURRENCY_CATALOG,
      useFactory: (catalog: CurrencyCatalogQuery) => new SettingsCurrencyCatalogAdapter(catalog),
      inject: [CurrencyCatalogQuery],
    },
    {
      provide: BILLING_PROJECTS,
      useFactory: (lookups: FinanceLookups) => new CommercialBillingProjectsAdapter(lookups),
      inject: [FinanceLookups],
    },
    { provide: BILLING_REPOSITORY, useClass: PrismaBillingRepository },
    {
      provide: BillingTransaction,
      useFactory: (
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        projects: BillingProjectsPort,
        projector: FinanceProjector,
        activity: ActivityLogPort,
      ) => new BillingTransaction(uow, locks, projects, projector, activity),
      inject: [UNIT_OF_WORK, ROW_LOCKS, BILLING_PROJECTS, FinanceProjector, ACTIVITY_LOG],
    },
    {
      provide: RecurringGenerator,
      useFactory: (repository: BillingRepository, ids: IdGeneratorPort) =>
        new RecurringGenerator(repository, ids),
      inject: [BILLING_REPOSITORY, ID_GENERATOR],
    },
    {
      provide: GetBillingPage,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        projects: BillingProjectsPort,
        repository: BillingRepository,
      ) => new GetBillingPage(authorization, uow, projects, repository),
      inject: [AUTHORIZATION, UNIT_OF_WORK, BILLING_PROJECTS, BILLING_REPOSITORY],
    },
    {
      provide: UpsertBillingPlan,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        rates: ExchangeRatePort,
        currencies: CurrencyCatalogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new UpsertBillingPlan(authorization, tx, repository, rates, currencies, clock, ids),
      inject: [
        AUTHORIZATION,
        BillingTransaction,
        BILLING_REPOSITORY,
        EXCHANGE_RATE,
        CURRENCY_CATALOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ApplyInstallmentTemplate,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        currencies: CurrencyCatalogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new ApplyInstallmentTemplate(authorization, tx, repository, currencies, clock, ids),
      inject: [
        AUTHORIZATION,
        BillingTransaction,
        BILLING_REPOSITORY,
        CURRENCY_CATALOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: CreateInstallment,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        currencies: CurrencyCatalogPort,
        ids: IdGeneratorPort,
      ) => new CreateInstallment(authorization, tx, repository, currencies, ids),
      inject: [
        AUTHORIZATION,
        BillingTransaction,
        BILLING_REPOSITORY,
        CURRENCY_CATALOG,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateInstallment,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        currencies: CurrencyCatalogPort,
        clock: ClockPort,
      ) => new UpdateInstallment(authorization, tx, repository, currencies, clock),
      inject: [AUTHORIZATION, BillingTransaction, BILLING_REPOSITORY, CURRENCY_CATALOG, CLOCK],
    },
    {
      provide: CancelInstallment,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        clock: ClockPort,
      ) => new CancelInstallment(authorization, tx, repository, clock),
      inject: [AUTHORIZATION, BillingTransaction, BILLING_REPOSITORY, CLOCK],
    },
    {
      provide: CreateRecurringCharge,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        rates: ExchangeRatePort,
        currencies: CurrencyCatalogPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new CreateRecurringCharge(authorization, tx, repository, rates, currencies, clock, ids),
      inject: [
        AUTHORIZATION,
        BillingTransaction,
        BILLING_REPOSITORY,
        EXCHANGE_RATE,
        CURRENCY_CATALOG,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateRecurringCharge,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        rates: ExchangeRatePort,
        currencies: CurrencyCatalogPort,
        clock: ClockPort,
      ) => new UpdateRecurringCharge(authorization, tx, repository, rates, currencies, clock),
      inject: [
        AUTHORIZATION,
        BillingTransaction,
        BILLING_REPOSITORY,
        EXCHANGE_RATE,
        CURRENCY_CATALOG,
        CLOCK,
      ],
    },
    {
      provide: SetRecurringChargeStatus,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        clock: ClockPort,
      ) => new SetRecurringChargeStatus(authorization, tx, repository, clock),
      inject: [AUTHORIZATION, BillingTransaction, BILLING_REPOSITORY, CLOCK],
    },
    {
      provide: GenerateMissingPeriods,
      useFactory: (
        authorization: AuthorizationPort,
        tx: BillingTransaction,
        repository: BillingRepository,
        generator: RecurringGenerator,
        clock: ClockPort,
      ) => new GenerateMissingPeriods(authorization, tx, repository, generator, clock),
      inject: [AUTHORIZATION, BillingTransaction, BILLING_REPOSITORY, RecurringGenerator, CLOCK],
    },
    {
      provide: GenerateRecurringInstallments,
      useFactory: (
        tx: BillingTransaction,
        repository: BillingRepository,
        generator: RecurringGenerator,
        clock: ClockPort,
      ) => new GenerateRecurringInstallments(tx, repository, generator, clock),
      inject: [BillingTransaction, BILLING_REPOSITORY, RecurringGenerator, CLOCK],
    },
    {
      provide: RecomputeInstallmentStatus,
      useFactory: (uow: UnitOfWorkPort, repository: BillingRepository) =>
        new RecomputeInstallmentStatus(uow, repository),
      inject: [UNIT_OF_WORK, BILLING_REPOSITORY],
    },
    {
      provide: ProjectBillingApi,
      useFactory: (
        uow: UnitOfWorkPort,
        repository: BillingRepository,
        projects: BillingProjectsPort,
        projector: FinanceProjector,
        clock: ClockPort,
      ) => new ProjectBillingApi(uow, repository, projects, projector, clock),
      inject: [UNIT_OF_WORK, BILLING_REPOSITORY, BILLING_PROJECTS, FinanceProjector, CLOCK],
    },
  ],
  exports: [RecomputeInstallmentStatus, ProjectBillingApi, GenerateRecurringInstallments],
})
export class BillingModule {}
