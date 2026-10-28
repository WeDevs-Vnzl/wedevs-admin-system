import { Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  CURRENCY_REPOSITORY,
  type CurrencyRepository,
} from './application/ports/currency.repository.port';
import {
  EXPENSE_CATEGORY_REPOSITORY,
  type ExpenseCategoryRepository,
} from './application/ports/expense-category.repository.port';
import {
  PAYMENT_METHOD_REPOSITORY,
  type PaymentMethodRepository,
} from './application/ports/payment-method.repository.port';
import { SETTING_REPOSITORY, type SettingRepository } from './application/ports/setting.repository';
import { FiscalSettingsQuery } from './application/fiscal-settings.query';
import { CreateCurrency } from './application/use-cases/create-currency.use-case';
import { CreateExpenseCategory } from './application/use-cases/create-expense-category.use-case';
import { CreatePaymentMethod } from './application/use-cases/create-payment-method.use-case';
import { GetFiscalSettings } from './application/use-cases/get-fiscal-settings.use-case';
import { ListCurrencies } from './application/use-cases/list-currencies.use-case';
import { ListExpenseCategories } from './application/use-cases/list-expense-categories.use-case';
import { ListPaymentMethods } from './application/use-cases/list-payment-methods.use-case';
import { UpdateCurrency } from './application/use-cases/update-currency.use-case';
import { UpdateExpenseCategory } from './application/use-cases/update-expense-category.use-case';
import { UpdateFiscalSettings } from './application/use-cases/update-fiscal-settings.use-case';
import { UpdatePaymentMethod } from './application/use-cases/update-payment-method.use-case';
import { PrismaCurrencyRepository } from './infrastructure/prisma-currency.repository';
import { PrismaExpenseCategoryRepository } from './infrastructure/prisma-expense-category.repository';
import { PrismaPaymentMethodRepository } from './infrastructure/prisma-payment-method.repository';
import { PrismaSettingRepository } from './infrastructure/prisma-setting.repository';
import { CurrenciesController } from './interface/http/currencies.controller';
import { ExpenseCategoriesController } from './interface/http/expense-categories.controller';
import { FiscalSettingsController } from './interface/http/fiscal-settings.controller';
import { PaymentMethodsController } from './interface/http/payment-methods.controller';

/**
 * Finance catalogs of the `settings` context (PRD §8.15, §8.8): currencies, payment methods, the expense category
 * tree and the fiscal parameters. Every write runs `can(…, 'settings')` first and logs one `SETTINGS_CHANGE` in its
 * unit of work. The fiscal parameters are stored under the `fiscal` key of the shared `Setting` table through this
 * module's own binding of the existing `SettingRepository` adapter (the company settings module keeps its own).
 * `FiscalSettingsQuery` is exported for BE-3. Exchange rates are BE-3.
 */
@Module({
  controllers: [
    CurrenciesController,
    PaymentMethodsController,
    ExpenseCategoriesController,
    FiscalSettingsController,
  ],
  providers: [
    { provide: CURRENCY_REPOSITORY, useClass: PrismaCurrencyRepository },
    { provide: PAYMENT_METHOD_REPOSITORY, useClass: PrismaPaymentMethodRepository },
    { provide: EXPENSE_CATEGORY_REPOSITORY, useClass: PrismaExpenseCategoryRepository },
    { provide: SETTING_REPOSITORY, useClass: PrismaSettingRepository },
    {
      provide: FiscalSettingsQuery,
      useFactory: (settings: SettingRepository) => new FiscalSettingsQuery(settings),
      inject: [SETTING_REPOSITORY],
    },
    {
      provide: ListCurrencies,
      useFactory: (currencies: CurrencyRepository) => new ListCurrencies(currencies),
      inject: [CURRENCY_REPOSITORY],
    },
    {
      provide: CreateCurrency,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        currencies: CurrencyRepository,
        activityLog: ActivityLogPort,
      ) => new CreateCurrency(authorization, uow, currencies, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, CURRENCY_REPOSITORY, ACTIVITY_LOG],
    },
    {
      provide: UpdateCurrency,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        currencies: CurrencyRepository,
        activityLog: ActivityLogPort,
      ) => new UpdateCurrency(authorization, uow, currencies, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, CURRENCY_REPOSITORY, ACTIVITY_LOG],
    },
    {
      provide: ListPaymentMethods,
      useFactory: (methods: PaymentMethodRepository) => new ListPaymentMethods(methods),
      inject: [PAYMENT_METHOD_REPOSITORY],
    },
    {
      provide: CreatePaymentMethod,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        methods: PaymentMethodRepository,
        ids: IdGeneratorPort,
        activityLog: ActivityLogPort,
      ) => new CreatePaymentMethod(authorization, uow, methods, ids, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PAYMENT_METHOD_REPOSITORY, ID_GENERATOR, ACTIVITY_LOG],
    },
    {
      provide: UpdatePaymentMethod,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        methods: PaymentMethodRepository,
        activityLog: ActivityLogPort,
      ) => new UpdatePaymentMethod(authorization, uow, methods, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, PAYMENT_METHOD_REPOSITORY, ACTIVITY_LOG],
    },
    {
      provide: ListExpenseCategories,
      useFactory: (categories: ExpenseCategoryRepository) => new ListExpenseCategories(categories),
      inject: [EXPENSE_CATEGORY_REPOSITORY],
    },
    {
      provide: CreateExpenseCategory,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: ExpenseCategoryRepository,
        ids: IdGeneratorPort,
        activityLog: ActivityLogPort,
      ) => new CreateExpenseCategory(authorization, uow, categories, ids, activityLog),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        EXPENSE_CATEGORY_REPOSITORY,
        ID_GENERATOR,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: UpdateExpenseCategory,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: ExpenseCategoryRepository,
        activityLog: ActivityLogPort,
      ) => new UpdateExpenseCategory(authorization, uow, categories, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, EXPENSE_CATEGORY_REPOSITORY, ACTIVITY_LOG],
    },
    {
      provide: GetFiscalSettings,
      useFactory: (query: FiscalSettingsQuery) => new GetFiscalSettings(query),
      inject: [FiscalSettingsQuery],
    },
    {
      provide: UpdateFiscalSettings,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        settings: SettingRepository,
        currencies: CurrencyRepository,
        activityLog: ActivityLogPort,
      ) => new UpdateFiscalSettings(authorization, uow, settings, currencies, activityLog),
      inject: [AUTHORIZATION, UNIT_OF_WORK, SETTING_REPOSITORY, CURRENCY_REPOSITORY, ACTIVITY_LOG],
    },
  ],
  exports: [FiscalSettingsQuery],
})
export class FinanceCatalogsModule {}
