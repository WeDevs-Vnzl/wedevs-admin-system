import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AccountsModule } from '../../../../src/modules/finance/accounts.module';
import { BillingModule } from '../../../../src/modules/finance/billing.module';
import { ExpensesModule } from '../../../../src/modules/finance/expenses.module';
import { InvoicesModule } from '../../../../src/modules/finance/invoices.module';
import { PaymentsModule } from '../../../../src/modules/finance/payments.module';
import { RatesModule } from '../../../../src/modules/finance/rates.module';
import { ReadModelsModule } from '../../../../src/modules/finance/read-models.module';
import { RecomputeAll } from '../../../../src/modules/finance/application/recompute-all';
import { CreateAccount } from '../../../../src/modules/finance/application/use-cases/accounts/create-account.use-case';
import { CreateMovement } from '../../../../src/modules/finance/application/use-cases/accounts/create-movement.use-case';
import { CreateTransfer } from '../../../../src/modules/finance/application/use-cases/accounts/create-transfer.use-case';
import { ReconcileAccount } from '../../../../src/modules/finance/application/use-cases/accounts/reconcile-account.use-case';
import { UpdateAccount } from '../../../../src/modules/finance/application/use-cases/accounts/update-account.use-case';
import { ApplyInstallmentTemplate } from '../../../../src/modules/finance/application/use-cases/billing/apply-installment-template.use-case';
import { CancelInstallment } from '../../../../src/modules/finance/application/use-cases/billing/cancel-installment.use-case';
import { CreateInstallment } from '../../../../src/modules/finance/application/use-cases/billing/create-installment.use-case';
import { CreateRecurringCharge } from '../../../../src/modules/finance/application/use-cases/billing/create-recurring-charge.use-case';
import { GenerateMissingPeriods } from '../../../../src/modules/finance/application/use-cases/billing/generate-missing-periods.use-case';
import { GenerateRecurringInstallments } from '../../../../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { ProjectBillingApi } from '../../../../src/modules/finance/application/use-cases/billing/project-billing.api';
import { SetRecurringChargeStatus } from '../../../../src/modules/finance/application/use-cases/billing/set-recurring-charge-status.use-case';
import { UpdateInstallment } from '../../../../src/modules/finance/application/use-cases/billing/update-installment.use-case';
import { UpdateRecurringCharge } from '../../../../src/modules/finance/application/use-cases/billing/update-recurring-charge.use-case';
import { UpsertBillingPlan } from '../../../../src/modules/finance/application/use-cases/billing/upsert-billing-plan.use-case';
import { CreateExpense } from '../../../../src/modules/finance/application/use-cases/expenses/create-expense.use-case';
import { GenerateRecurringExpenses } from '../../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkExpensePaid } from '../../../../src/modules/finance/application/use-cases/expenses/mark-expense-paid.use-case';
import {
  CreateRecurringExpense,
  SetRecurringExpenseStatus,
  UpdateRecurringExpense,
} from '../../../../src/modules/finance/application/use-cases/expenses/recurring-expense.use-cases';
import { UpdateExpense } from '../../../../src/modules/finance/application/use-cases/expenses/update-expense.use-case';
import { VoidExpense } from '../../../../src/modules/finance/application/use-cases/expenses/void-expense.use-case';
import { ArchiveInvoice } from '../../../../src/modules/finance/application/use-cases/invoices/archive-invoice.use-case';
import { CreateInvoice } from '../../../../src/modules/finance/application/use-cases/invoices/create-invoice.use-case';
import { IssueDraft } from '../../../../src/modules/finance/application/use-cases/invoices/issue-draft.use-case';
import { MarkOverdueInvoices } from '../../../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { RestoreInvoice } from '../../../../src/modules/finance/application/use-cases/invoices/restore-invoice.use-case';
import { UpdateInvoice } from '../../../../src/modules/finance/application/use-cases/invoices/update-invoice.use-case';
import { VoidInvoice } from '../../../../src/modules/finance/application/use-cases/invoices/void-invoice.use-case';
import {
  AllocatePayment,
  DeallocatePayment,
} from '../../../../src/modules/finance/application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from '../../../../src/modules/finance/application/use-cases/payments/create-payment.use-case';
import { SetPaymentStatus } from '../../../../src/modules/finance/application/use-cases/payments/set-payment-status.use-case';
import { UpdatePayment } from '../../../../src/modules/finance/application/use-cases/payments/update-payment.use-case';
import { ImportRatesCsv } from '../../../../src/modules/finance/application/use-cases/rates/import-rates-csv.use-case';
import { LoadDailyRates } from '../../../../src/modules/finance/application/use-cases/rates/load-daily-rates.use-case';
import { UpsertExchangeRate } from '../../../../src/modules/finance/application/use-cases/rates/upsert-exchange-rate.use-case';
import { MatrixAuthorization } from '../../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../../src/shared/application/current-user';
import {
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  UNIT_OF_WORK,
} from '../../../../src/shared/application/ports/tokens';
import type { RowLocksPort } from '../../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../src/shared/application/ports/unit-of-work.port';
import { todayInCaracas, type DateOnly } from '../../../../src/shared/domain/business-date';
import type { PrismaClient } from '../../../../src/generated/prisma/client';
import { createTestPrisma } from '../../../support/db';
import { FixedClock } from '../../../support/fakes/fixed-clock';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';
import { assertLocalDatabaseUrl } from '../../../support/local-db-guard';
import { createTestApp } from '../../../support/test-app';

/** Every money mutation use case (and the SYSTEM steps), resolved from the sub-modules' own providers. */
export interface UseCases {
  readonly upsertRate: UpsertExchangeRate;
  readonly loadDailyRates: LoadDailyRates;
  readonly importRates: ImportRatesCsv;
  readonly upsertPlan: UpsertBillingPlan;
  readonly applyTemplate: ApplyInstallmentTemplate;
  readonly createInstallment: CreateInstallment;
  readonly updateInstallment: UpdateInstallment;
  readonly cancelInstallment: CancelInstallment;
  readonly createCharge: CreateRecurringCharge;
  readonly updateCharge: UpdateRecurringCharge;
  readonly setChargeStatus: SetRecurringChargeStatus;
  readonly generateMissingPeriods: GenerateMissingPeriods;
  readonly generateRecurringInstallments: GenerateRecurringInstallments;
  readonly projectBilling: ProjectBillingApi;
  readonly createAccount: CreateAccount;
  readonly updateAccount: UpdateAccount;
  readonly createTransfer: CreateTransfer;
  readonly createMovement: CreateMovement;
  readonly reconcile: ReconcileAccount;
  readonly createExpense: CreateExpense;
  readonly updateExpense: UpdateExpense;
  readonly markExpensePaid: MarkExpensePaid;
  readonly voidExpense: VoidExpense;
  readonly createRecurringExpense: CreateRecurringExpense;
  readonly updateRecurringExpense: UpdateRecurringExpense;
  readonly setRecurringExpenseStatus: SetRecurringExpenseStatus;
  readonly generateRecurringExpenses: GenerateRecurringExpenses;
  readonly createInvoice: CreateInvoice;
  readonly updateInvoice: UpdateInvoice;
  readonly issueDraft: IssueDraft;
  readonly voidInvoice: VoidInvoice;
  readonly archiveInvoice: ArchiveInvoice;
  readonly restoreInvoice: RestoreInvoice;
  readonly markOverdue: MarkOverdueInvoices;
  readonly createPayment: CreatePayment;
  readonly updatePayment: UpdatePayment;
  readonly setPaymentStatus: SetPaymentStatus;
  readonly allocate: AllocatePayment;
  readonly deallocate: DeallocatePayment;
}

export interface World {
  readonly app: NestExpressApplication;
  readonly db: PrismaClient;
  readonly clock: FixedClock;
  readonly uc: UseCases;
  readonly recomputeAll: RecomputeAll;
  readonly uow: UnitOfWorkPort;
  readonly locks: RowLocksPort;
  readonly owner: CurrentUser;
  readonly viewer: CurrentUser;
  readonly today: () => DateOnly;
  readonly close: () => Promise<void>;
}

/** Models whose rows the generator picks from: read in id order so a seed replays the same run. */
const ORDERED_MODELS = new Set([
  'BillingPlan',
  'BillingInstallment',
  'RecurringCharge',
  'RecurringExpense',
  'Invoice',
  'Payment',
  'PaymentAllocation',
  'Account',
  'Expense',
  'Project',
]);

function orderedClient(): PrismaClient {
  const base = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  return base.$extends({
    query: {
      $allModels: {
        findMany({ model, args, query }) {
          const ordered = ORDERED_MODELS.has(model) && !args.orderBy;
          return query((ordered ? { ...args, orderBy: { id: 'asc' } } : args) as typeof args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export const START = '2026-03-10T15:00:00.000Z';

async function user(db: PrismaClient, role: 'OWNER' | 'VIEWER'): Promise<CurrentUser> {
  const lower = role.toLowerCase();
  const row = await db.user.create({
    data: {
      clerkId: `user_equiv_${lower}`,
      email: `${lower}@equiv.example.test`,
      name: `Equiv ${role}`,
      role,
    },
  });
  return { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
}

/**
 * Boots a Nest app from the finance sub-modules only (no `AppModule` finance wiring is assumed), over
 * the spec's own database, with the real authorization matrix and a settable clock.
 */
export async function bootWorld(): Promise<World> {
  const db = orderedClient();
  const clock = new FixedClock(START);
  const app = await createTestApp({
    probes: false,
    modules: [
      RatesModule,
      BillingModule,
      AccountsModule,
      ExpensesModule,
      InvoicesModule,
      PaymentsModule,
      ReadModelsModule,
    ],
    overrides: [
      { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
      { token: CLOCK, useValue: clock },
      { token: ID_GENERATOR, useValue: new SequentialIdGenerator('x') },
    ],
  });
  const get = <T>(token: Type<T>): T => app.get(token, { strict: false });
  const uc: UseCases = {
    upsertRate: get(UpsertExchangeRate),
    loadDailyRates: get(LoadDailyRates),
    importRates: get(ImportRatesCsv),
    upsertPlan: get(UpsertBillingPlan),
    applyTemplate: get(ApplyInstallmentTemplate),
    createInstallment: get(CreateInstallment),
    updateInstallment: get(UpdateInstallment),
    cancelInstallment: get(CancelInstallment),
    createCharge: get(CreateRecurringCharge),
    updateCharge: get(UpdateRecurringCharge),
    setChargeStatus: get(SetRecurringChargeStatus),
    generateMissingPeriods: get(GenerateMissingPeriods),
    generateRecurringInstallments: get(GenerateRecurringInstallments),
    projectBilling: get(ProjectBillingApi),
    createAccount: get(CreateAccount),
    updateAccount: get(UpdateAccount),
    createTransfer: get(CreateTransfer),
    createMovement: get(CreateMovement),
    reconcile: get(ReconcileAccount),
    createExpense: get(CreateExpense),
    updateExpense: get(UpdateExpense),
    markExpensePaid: get(MarkExpensePaid),
    voidExpense: get(VoidExpense),
    createRecurringExpense: get(CreateRecurringExpense),
    updateRecurringExpense: get(UpdateRecurringExpense),
    setRecurringExpenseStatus: get(SetRecurringExpenseStatus),
    generateRecurringExpenses: get(GenerateRecurringExpenses),
    createInvoice: get(CreateInvoice),
    updateInvoice: get(UpdateInvoice),
    issueDraft: get(IssueDraft),
    voidInvoice: get(VoidInvoice),
    archiveInvoice: get(ArchiveInvoice),
    restoreInvoice: get(RestoreInvoice),
    markOverdue: get(MarkOverdueInvoices),
    createPayment: get(CreatePayment),
    updatePayment: get(UpdatePayment),
    setPaymentStatus: get(SetPaymentStatus),
    allocate: get(AllocatePayment),
    deallocate: get(DeallocatePayment),
  };
  return {
    app,
    db,
    clock,
    uc,
    recomputeAll: get(RecomputeAll),
    uow: app.get<UnitOfWorkPort>(UNIT_OF_WORK, { strict: false }),
    locks: app.get<RowLocksPort>(ROW_LOCKS, { strict: false }),
    owner: await user(db, 'OWNER'),
    viewer: await user(db, 'VIEWER'),
    today: () => todayInCaracas(clock.now()),
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}
