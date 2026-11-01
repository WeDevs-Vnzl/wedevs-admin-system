import { CreateExpense } from '../../../src/modules/finance/application/use-cases/expenses/create-expense.use-case';
import { GenerateRecurringExpenses } from '../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { ExpenseSupport } from '../../../src/modules/finance/application/use-cases/expenses/expense-support';
import {
  GetExpense,
  ListExpenses,
} from '../../../src/modules/finance/application/use-cases/expenses/list-expenses.use-case';
import { MarkExpensePaid } from '../../../src/modules/finance/application/use-cases/expenses/mark-expense-paid.use-case';
import {
  CreateRecurringExpense,
  GetRecurringExpense,
  ListRecurringExpenses,
  SetRecurringExpenseStatus,
  UpdateRecurringExpense,
} from '../../../src/modules/finance/application/use-cases/expenses/recurring-expense.use-cases';
import { RecurringExpenseSupport } from '../../../src/modules/finance/application/use-cases/expenses/recurring-expense-support';
import { UpdateExpense } from '../../../src/modules/finance/application/use-cases/expenses/update-expense.use-case';
import { VoidExpense } from '../../../src/modules/finance/application/use-cases/expenses/void-expense.use-case';
import type { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import type { ExpenseRecord } from '../../../src/modules/finance/application/ports/expense.repository.port';
import type { RecurringExpenseRecord } from '../../../src/modules/finance/application/ports/expense-recurring.repository.port';
import type {
  ExpenseAccountRef,
  ExpenseReceiptFilesPort,
  ExpenseReferencesPort,
} from '../../../src/modules/finance/application/ports/expense-references.port';
import type { ExchangeRatePort } from '../../../src/modules/finance/application/ports/exchange-rate.port';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { NotFoundError } from '../../../src/shared/domain/domain-error';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../support/fakes/in-memory-sequence';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import {
  InMemoryExpenseRepository,
  InMemoryRecurringExpenseRepository,
} from './fakes/in-memory-expense.repositories';

/** 2026-10-09 in Caracas (the mock's "today"). */
export const NOW = '2026-10-09T15:00:00.000Z';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

export async function rejection(promise: Promise<unknown>): Promise<{
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected the promise to reject');
}

export const CATEGORY = 'cat_hosting';
export const PROJECT = 'pry_kairos';
export const VES = 'acc_ves';
export const ZELLE = 'acc_zelle';

export const expenseRecord = (over: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: 'exp_seed',
  code: 'GAS-0100',
  date: '2026-10-05',
  dueDate: null,
  paidAt: null,
  description: 'Seed',
  vendor: null,
  categoryId: CATEGORY,
  accountId: null,
  projectId: null,
  currency: 'USD',
  amount: '10.00',
  accountAmount: null,
  usdRate: '1',
  amountUsd: '10.00',
  status: 'PENDIENTE',
  receiptFileId: null,
  recurringExpenseId: null,
  periodStart: null,
  createdAt: NOW,
  updatedAt: NOW,
  createdById: null,
  ...over,
});

export const recurringRecord = (
  over: Partial<RecurringExpenseRecord> = {},
): RecurringExpenseRecord => ({
  id: 'rex_seed',
  name: 'Hosting',
  vendor: null,
  categoryId: CATEGORY,
  accountId: null,
  projectId: null,
  currency: 'USD',
  amount: '120.00',
  frequency: 'MENSUAL',
  dayOfPeriod: 5,
  leadDays: 5,
  startDate: '2026-10-01',
  endDate: null,
  status: 'ACTIVO',
  lastGeneratedPeriodStart: null,
  resumedOn: null,
  usdRate: '1',
  monthlyAmountUsd: '120.00',
  createdAt: NOW,
  ...over,
});

/** Calls the projector in order, so a test can assert what a mutation recomputed. */
export class RecordingProjector {
  readonly calls: string[] = [];
  projectExpense = async (id: string) => void this.calls.push(`expense:${id}`);
  projectAccount = async (id: string) => void this.calls.push(`account:${id}`);
  projectProjects = async (ids: readonly string[]) =>
    void this.calls.push(`projects:${[...ids].sort().join(',')}`);
  projectClients = async (ids: readonly string[]) =>
    void this.calls.push(`clients:${[...ids].join(',')}`);
}

/** The expense use cases over in-memory ports and the real permission matrix. */
export function createWorld() {
  const uow = new InMemoryUnitOfWork();
  const expenses = new InMemoryExpenseRepository(uow);
  const recurring = new InMemoryRecurringExpenseRepository(expenses, uow);
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const locks = new InMemoryRowLocks(uow);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('gen');
  const authorization = new MatrixAuthorization();
  const projector = new RecordingProjector();

  const accounts = new Map<string, ExpenseAccountRef>([
    [VES, { id: VES, name: 'Caja VES', currency: 'VES' }],
    [ZELLE, { id: ZELLE, name: 'Zelle', currency: 'USD' }],
  ]);
  const categories = new Set([CATEGORY, 'cat_root']);
  const projects = new Set([PROJECT]);
  const references: ExpenseReferencesPort = {
    activeCategory: async (id) => (categories.has(id) ? { id } : null),
    activeAccount: async (id) => accounts.get(id) ?? null,
    liveProject: async (id) => (projects.has(id) ? { type: 'PROJECT', id, label: id } : null),
  };
  const reservedFiles: string[] = [];
  const knownFiles = new Set(['file_ok']);
  const receipts: ExpenseReceiptFilesPort = {
    reserve: async (_actor, fileId) => {
      if (!knownFiles.has(fileId)) throw new NotFoundError();
      reservedFiles.push(fileId);
      return { id: fileId };
    },
  };
  const rateTable = new Map<string, string>([['VES', '755.16']]);
  const rates: ExchangeRatePort = {
    getRateFor: async (date, currency) => {
      if (currency === 'USD') {
        return { usdRate: '1', source: null, isFallback: false, effectiveDate: date, options: [] };
      }
      const usdRate = rateTable.get(currency);
      return usdRate
        ? { usdRate, source: 'MANUAL', isFallback: false, effectiveDate: date, options: [] }
        : null;
    },
  };
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(codes.filter((code) => ['USD', 'VES', 'EUR'].includes(code))),
  };

  const support = new ExpenseSupport(
    expenses,
    references,
    receipts,
    projector as unknown as FinanceProjector,
    search,
    activity,
    clock,
    locks,
  );
  const recurringSupport = new RecurringExpenseSupport(
    recurring,
    references,
    rates,
    currencies,
    locks,
    activity,
    clock,
  );
  return {
    uow,
    expenses,
    recurring,
    activity,
    search,
    locks,
    clock,
    projector,
    rateTable,
    reservedFiles,
    accounts,
    projects,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    listExpenses: new ListExpenses(authorization, expenses, clock),
    getExpense: new GetExpense(authorization, expenses, clock),
    createExpense: new CreateExpense(authorization, uow, support, sequence, ids),
    updateExpense: new UpdateExpense(authorization, uow, support),
    markPaid: new MarkExpensePaid(authorization, uow, support),
    voidExpense: new VoidExpense(authorization, uow, support),
    listRecurring: new ListRecurringExpenses(authorization, recurring),
    getRecurring: new GetRecurringExpense(authorization, recurringSupport),
    createRecurring: new CreateRecurringExpense(authorization, uow, recurringSupport, ids),
    updateRecurring: new UpdateRecurringExpense(authorization, uow, recurringSupport),
    setRecurringStatus: new SetRecurringExpenseStatus(authorization, uow, recurringSupport),
    generate: new GenerateRecurringExpenses(
      uow,
      recurring,
      expenses,
      rates,
      sequence,
      locks,
      search,
      activity,
      clock,
      ids,
    ),
  };
}

export type World = ReturnType<typeof createWorld>;
