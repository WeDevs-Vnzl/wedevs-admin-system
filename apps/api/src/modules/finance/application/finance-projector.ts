import type { ClockPort } from '../../../shared/application/ports/clock.port';
import type { DateOnly } from '../../../shared/domain/business-date';
import {
  compareMoney,
  isZeroMoney,
  sumMoney,
  toUsd,
  type MoneyString,
} from '../../../shared/domain/money';
import { accountBalance } from '../domain/accounts';
import { splitByNetAmount, type FinanceFactSource } from '../domain/finance-fact';
import { computeProjectSummary } from '../domain/project-summary';
import type {
  ClientMetricsSource,
  ExpenseFactSource,
  FinanceSourcesPort,
  InvoiceFactSource,
  MovementFactSource,
  PaymentFactSource,
  ProjectMetricsSource,
  TransferFactSource,
} from './ports/finance-sources.port';
import type {
  ClientMoneyColumns,
  FactRow,
  ProjectMoneyColumns,
  ReadModelWriterPort,
} from './ports/read-model-writer.port';

/** Later than any real entry: the `Account.balance` cache counts everything dated, not a point in time. */
const BALANCE_UNTIL: DateOnly = '9999-12-31';
const OPEN_INVOICE_STATUSES = ['EMITIDA', 'PARCIAL', 'VENCIDA'];
const ZERO = '0.00';

/** Draft, voided and archived invoices produce no facts and count in no metric (data-rules §3b). */
function countsAsInvoiced(invoice: { status: string; isDraft: boolean }): boolean {
  return !invoice.isDraft && invoice.status !== 'BORRADOR' && invoice.status !== 'ANULADA';
}

/** Ascending by byte order, like `ORDER BY id COLLATE "C"`, without duplicates. */
function ascending(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function nonZero(rows: readonly FactRow[]): FactRow[] {
  return rows.filter((row) => !isZeroMoney(row.amountUsd));
}

function invoiceFacts(source: InvoiceFactSource): FactRow[] {
  if (source.archived || !countsAsInvoiced(source)) return [];
  const common = { date: source.issueDate, clientId: source.clientId, invoiceId: source.id };
  const billed: FactRow[] = splitByNetAmount(source.totalUsd, source.lines).map((part) => ({
    ...common,
    kind: 'BILLED',
    amountUsd: part.amountUsd,
    projectId: part.projectId,
    dueDate: source.dueDate,
  }));
  const taxes: FactRow[] = source.taxLines.map((line) => ({
    ...common,
    kind: 'IVA',
    amountUsd: toUsd(line.ivaAmount, source.usdRate),
    ivaRate: line.ivaRate,
  }));
  const withheld: FactRow[] = (
    [
      ['WITHHELD_IVA', source.ivaWithheld],
      ['WITHHELD_ISLR', source.islrWithheld],
      ['WITHHELD_OTHER', source.otherWithheld],
    ] as const
  ).map(([kind, amount]) => ({ ...common, kind, amountUsd: toUsd(amount, source.usdRate) }));
  return nonZero([...billed, ...taxes, ...withheld]);
}

function paymentFacts(source: PaymentFactSource): FactRow[] {
  if (source.archived || source.status !== 'CONFIRMADO') return [];
  const common = {
    date: source.date,
    clientId: source.clientId,
    accountId: source.accountId,
    methodId: source.methodId,
  };
  const collected: FactRow[] = source.allocations.flatMap((allocation) =>
    splitByNetAmount(allocation.amountUsd, allocation.invoiceLines).map((part) => ({
      ...common,
      kind: 'COLLECTED' as const,
      amountUsd: part.amountUsd,
      projectId: part.projectId,
      invoiceId: allocation.invoiceId,
    })),
  );
  const igtf: FactRow = {
    ...common,
    kind: 'IGTF',
    amountUsd: toUsd(source.igtfAmount, source.usdRate),
  };
  return nonZero([...collected, igtf]);
}

function expenseFacts(source: ExpenseFactSource): FactRow[] {
  if (source.archived || source.status !== 'PAGADO') return [];
  return nonZero([
    {
      kind: 'EXPENSE_PAID',
      date: source.paidDate,
      amountUsd: source.amountUsd,
      accountId: source.accountId,
      categoryId: source.categoryId,
      projectId: source.projectId,
    },
  ]);
}

function transferFacts(source: TransferFactSource): FactRow[] {
  if (source.archived) return [];
  return nonZero([
    {
      kind: 'TRANSFER_OUT',
      date: source.date,
      amountUsd: source.amountUsd,
      accountId: source.fromAccountId,
    },
    {
      kind: 'TRANSFER_IN',
      date: source.date,
      amountUsd: source.amountUsd,
      accountId: source.toAccountId,
    },
  ]);
}

/**
 * Contributions are `MOVEMENT_IN`, withdrawals `MOVEMENT_OUT` (both positive), and an `AJUSTE` is
 * `MOVEMENT_IN` carrying its sign (DT-106), so Σ IN − Σ OUT is the net movement.
 */
function movementFacts(source: MovementFactSource): FactRow[] {
  if (source.archived) return [];
  return nonZero([
    {
      kind: source.type === 'RETIRO_SOCIO' ? 'MOVEMENT_OUT' : 'MOVEMENT_IN',
      date: source.date,
      amountUsd: source.amountUsd,
      accountId: source.accountId,
    },
  ]);
}

function clientColumns(source: ClientMetricsSource): ClientMoneyColumns {
  const invoiced = source.invoices.filter(countsAsInvoiced);
  const balanceUsd = (invoice: ClientMetricsSource['invoices'][number]) =>
    toUsd(invoice.balance, invoice.usdRate);
  const open = invoiced.filter((invoice) => OPEN_INVOICE_STATUSES.includes(invoice.status));
  return {
    invoicedUsd: sumMoney(invoiced.map((invoice) => invoice.totalUsd)),
    collectedUsd: sumMoney(
      source.allocations
        .filter((allocation) => allocation.paymentStatus === 'CONFIRMADO')
        .map((allocation) => allocation.amountUsd),
    ),
    receivableUsd: sumMoney(open.map(balanceUsd)),
    overdueUsd: sumMoney(open.filter((invoice) => invoice.status === 'VENCIDA').map(balanceUsd)),
    creditUsd: sumMoney(
      source.payments
        .filter((payment) => payment.status === 'CONFIRMADO')
        .map((payment) => toUsd(payment.unallocated, payment.usdRate)),
    ),
  };
}

/**
 * A plan-currency amount in USD at the plan's own snapshot rate (D1, C16: never today's rate). USD passes
 * through; another currency without a matching snapshot adds nothing.
 */
function planUsd(
  plan: ProjectMetricsSource['plan'],
  amount: MoneyString,
  currency: string,
): MoneyString | null {
  if (currency === 'USD') return amount;
  if (!plan || plan.currency !== currency || plan.usdRate === null) return null;
  return toUsd(amount, plan.usdRate);
}

function atLeastZero(value: MoneyString | null): MoneyString {
  return value !== null && compareMoney(value, ZERO) > 0 ? value : ZERO;
}

function projectColumns(source: ProjectMetricsSource): ProjectMoneyColumns {
  const summary = computeProjectSummary({
    model: source.plan?.model ?? null,
    contractedUsd: source.plan?.contractedUsd ?? null,
    adjustmentsUsd: source.adjustments
      .map((item) => planUsd(source.plan, item.amount, item.currency))
      .filter((amount): amount is MoneyString => amount !== null),
    lines: source.lines.filter(countsAsInvoicedLine).map((line) => ({
      netAmountUsd: toUsd(line.netAmount, line.invoiceUsdRate),
      invoiceReceivable: line.invoiceReceivable,
      invoicePaid: line.invoicePaid,
    })),
    monthlyRecurringUsd: source.recurringMonthlyUsd,
    allocatedExpensesUsd: sumMoney(source.paidExpensesUsd),
  });
  // The columns serve the tables, which show the headline: never below zero (projects.ts `projectHeadline`).
  return {
    contractedUsd: atLeastZero(summary.contractedValue),
    invoicedUsd: summary.invoiced,
    collectedUsd: summary.collected,
    toInvoiceUsd: atLeastZero(summary.toInvoice),
    receivableUsd: summary.receivable,
    expensesUsd: summary.allocatedExpenses,
    marginUsd: summary.margin,
    monthlyRecurringUsd: summary.monthlyRecurring,
  };
}

function countsAsInvoicedLine(line: ProjectMetricsSource['lines'][number]): boolean {
  return countsAsInvoiced({ status: line.invoiceStatus, isDraft: line.invoiceIsDraft });
}

/**
 * Recomputes the finance read models of a source from the database, never by incrementing (C12, C16,
 * C18; data-rules §3b). Valid only inside `UnitOfWorkPort.run`, after the caller took its row locks in
 * the global lock order and wrote the sources. Call it in the documented order: facts, `projectAccount`,
 * `projectClients` (ascending), `projectProjects` (ascending). The metrics projections take their own
 * `FOR UPDATE` on the metrics rows before they read, so two projections of one client cannot lose each
 * other's contribution.
 *
 * A source that is missing, archived, draft or voided has its facts deleted and none inserted.
 * The caller names the clients and projects to project: the old and the new ones when a source moved.
 */
export class FinanceProjector {
  constructor(
    private readonly sources: FinanceSourcesPort,
    private readonly writer: ReadModelWriterPort,
    private readonly clock: ClockPort,
  ) {}

  async projectInvoice(id: string): Promise<void> {
    const source = await this.sources.invoiceFacts(id);
    await this.replace('INVOICE', id, source ? invoiceFacts(source) : []);
  }

  async projectPayment(id: string): Promise<void> {
    const source = await this.sources.paymentFacts(id);
    await this.replace('PAYMENT', id, source ? paymentFacts(source) : []);
  }

  async projectExpense(id: string): Promise<void> {
    const source = await this.sources.expenseFacts(id);
    await this.replace('EXPENSE', id, source ? expenseFacts(source) : []);
  }

  async projectTransfer(id: string): Promise<void> {
    const source = await this.sources.transferFacts(id);
    await this.replace('TRANSFER', id, source ? transferFacts(source) : []);
  }

  async projectMovement(id: string): Promise<void> {
    const source = await this.sources.movementFacts(id);
    await this.replace('MOVEMENT', id, source ? movementFacts(source) : []);
  }

  /**
   * Writes `Account.balance` and `balanceAt`. The caller holds the `Account` row lock (global lock
   * order), which serializes projections of one account.
   */
  async projectAccount(id: string): Promise<void> {
    const source = await this.sources.accountSource(id);
    if (!source) return;
    await this.writer.writeAccountBalance(
      id,
      accountBalance(source.activity, BALANCE_UNTIL),
      this.clock.now(),
    );
  }

  async projectClient(id: string): Promise<void> {
    await this.projectClients([id]);
  }

  /** Locks the `ClientMetrics` rows ascending, then recomputes each. Unknown clients are skipped. */
  async projectClients(ids: readonly string[]): Promise<void> {
    const ordered = ascending(ids);
    if (ordered.length === 0) return;
    await this.writer.lockClientMetrics(ordered);
    for (const id of ordered) {
      const source = await this.sources.clientMetricsSource(id);
      if (source) await this.writer.writeClientMetrics(id, clientColumns(source));
    }
  }

  async projectProject(id: string): Promise<void> {
    await this.projectProjects([id]);
  }

  /** Locks the `ProjectMetrics` rows ascending, then recomputes each. Unknown projects are skipped. */
  async projectProjects(ids: readonly string[]): Promise<void> {
    const ordered = ascending(ids);
    if (ordered.length === 0) return;
    await this.writer.lockProjectMetrics(ordered);
    for (const id of ordered) {
      const source = await this.sources.projectMetricsSource(id);
      if (source) await this.writer.writeProjectMetrics(id, projectColumns(source));
    }
  }

  private replace(type: FinanceFactSource, id: string, facts: FactRow[]): Promise<void> {
    return this.writer.replaceFacts(type, id, facts);
  }
}
