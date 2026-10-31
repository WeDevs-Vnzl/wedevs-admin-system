import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import type { ExchangeRatePort } from '../../../src/modules/finance/application/ports/exchange-rate.port';
import type { ExpenseReceiptFilesPort } from '../../../src/modules/finance/application/ports/expense-references.port';
import { CreateExpense } from '../../../src/modules/finance/application/use-cases/expenses/create-expense.use-case';
import { ExpenseSupport } from '../../../src/modules/finance/application/use-cases/expenses/expense-support';
import { GenerateRecurringExpenses } from '../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkExpensePaid } from '../../../src/modules/finance/application/use-cases/expenses/mark-expense-paid.use-case';
import { VoidExpense } from '../../../src/modules/finance/application/use-cases/expenses/void-expense.use-case';
import { ExpenseCategoryCatalogQuery } from '../../../src/modules/settings/application/expense-category-catalog.query';
import { PrismaExpenseCategoryRepository } from '../../../src/modules/settings/infrastructure/prisma-expense-category.repository';
import { PrismaExpenseReferences } from '../../../src/modules/finance/infrastructure/expense-references.adapter';
import { PrismaExpenseRecurringRepository } from '../../../src/modules/finance/infrastructure/prisma-expense-recurring.repository';
import { PrismaExpenseRepository } from '../../../src/modules/finance/infrastructure/prisma-expense.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { SequencePort } from '../../../src/shared/application/ports/sequence.port';
import type { PrismaReadModelWriter } from '../../../src/modules/finance/infrastructure/prisma-read-model-writer';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaSequence } from '../../../src/shared/infrastructure/prisma/prisma-sequence';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { buildWorld as buildReadModels } from '../read-models/world';

export interface ExpenseWorldHooks {
  /** Decorates the row locks. */
  locks?: (locks: RowLocksPort) => RowLocksPort;
  /** Decorates the read-model writer, e.g. to pause a transaction once the source row is written. */
  writer?: (writer: PrismaReadModelWriter) => PrismaReadModelWriter;
  /** Decorates the code sequence, e.g. to pause a generation before it creates a period. */
  sequence?: (sequence: SequencePort) => SequencePort;
}

const usdOnly: ExchangeRatePort = {
  getRateFor: async (date) => ({
    usdRate: '1',
    source: null,
    isFallback: false,
    effectiveDate: date,
    options: [],
  }),
};
const receipts: ExpenseReceiptFilesPort = { reserve: async (_actor, id) => ({ id }) };

/** The expense use cases over the real adapters, sharing one `TransactionHost` per world. */
export function buildExpenseWorld(service: PrismaService, hooks: ExpenseWorldHooks = {}) {
  const base = buildReadModels(service, hooks.writer ? { writer: hooks.writer } : {});
  const { host, uow, projector, metrics } = base;
  const authorization = new MatrixAuthorization();
  const clock = new SystemClock();
  const ids = new CuidGenerator();
  const locks = (hooks.locks ?? ((l) => l))(new PrismaRowLocks(host));
  const search = new PrismaSearchIndex(host);
  const sequence = (hooks.sequence ?? ((s) => s))(new PrismaSequence(host));
  const activity = new PrismaActivityLog(host, metrics);
  const expenses = new PrismaExpenseRepository(host);
  const recurring = new PrismaExpenseRecurringRepository(host);
  const references = new PrismaExpenseReferences(
    host,
    new FinanceLookups(new PrismaFinanceLookups(host)),
    new ExpenseCategoryCatalogQuery(new PrismaExpenseCategoryRepository(host)),
  );
  const support = new ExpenseSupport(
    expenses,
    references,
    receipts,
    projector,
    search,
    activity,
    clock,
    locks,
  );
  return {
    ...base,
    expenses,
    recurring,
    createExpense: new CreateExpense(authorization, uow, support, sequence, ids),
    markPaid: new MarkExpensePaid(authorization, uow, support),
    voidExpense: new VoidExpense(authorization, uow, support),
    generate: new GenerateRecurringExpenses(
      uow,
      recurring,
      expenses,
      usdOnly,
      sequence,
      locks,
      search,
      activity,
      clock,
      ids,
    ),
  };
}

export type ExpenseWorld = ReturnType<typeof buildExpenseWorld>;
