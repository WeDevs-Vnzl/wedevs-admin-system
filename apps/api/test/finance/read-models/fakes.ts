import type {
  AccountSource,
  ClientMetricsSource,
  ExpenseFactSource,
  FinanceSourceIds,
  FinanceSourcesPort,
  InstallmentCacheSource,
  InvoiceCacheSource,
  InvoiceFactSource,
  MovementFactSource,
  PaymentCacheSource,
  PaymentFactSource,
  ProjectMetricsSource,
  RecurringCacheSource,
  TransferFactSource,
} from '../../../src/modules/finance/application/ports/finance-sources.port';
import type {
  ClientMoneyColumns,
  FactRow,
  InvoiceCacheWrite,
  ProjectMoneyColumns,
  ReadModelWriterPort,
} from '../../../src/modules/finance/application/ports/read-model-writer.port';
import type { FinanceFactSource } from '../../../src/modules/finance/domain/finance-fact';
import type { InstallmentStatus } from '../../../src/shared/domain/enums';

/** In-memory `FinanceSourcesPort`: tests fill the maps; an absent id answers `null`. */
export class InMemoryFinanceSources implements FinanceSourcesPort {
  /** Shared with the writer fake so a test sees reads and writes in one order. */
  constructor(readonly log: string[] = []) {}

  invoices = new Map<string, InvoiceFactSource>();
  payments = new Map<string, PaymentFactSource>();
  expenses = new Map<string, ExpenseFactSource>();
  transfers = new Map<string, TransferFactSource>();
  movements = new Map<string, MovementFactSource>();
  accounts = new Map<string, AccountSource>();
  clients = new Map<string, ClientMetricsSource>();
  projects = new Map<string, ProjectMetricsSource>();
  invoiceCaches = new Map<string, InvoiceCacheSource>();
  paymentCaches = new Map<string, PaymentCacheSource>();
  installmentCaches = new Map<string, InstallmentCacheSource>();
  chargeCaches = new Map<string, RecurringCacheSource>();
  recurringExpenseCaches = new Map<string, RecurringCacheSource>();
  ids: FinanceSourceIds = {
    clients: [],
    projects: [],
    recurringCharges: [],
    recurringExpenses: [],
    installments: [],
    invoices: [],
    payments: [],
    expenses: [],
    accounts: [],
    transfers: [],
    movements: [],
  };

  invoiceFacts = async (id: string) => this.invoices.get(id) ?? null;
  paymentFacts = async (id: string) => this.payments.get(id) ?? null;
  expenseFacts = async (id: string) => this.expenses.get(id) ?? null;
  transferFacts = async (id: string) => this.transfers.get(id) ?? null;
  movementFacts = async (id: string) => this.movements.get(id) ?? null;
  accountSource = async (id: string) => this.accounts.get(id) ?? null;
  clientMetricsSource = async (id: string) => {
    this.log.push(`read:client:${id}`);
    return this.clients.get(id) ?? null;
  };
  projectMetricsSource = async (id: string) => {
    this.log.push(`read:project:${id}`);
    return this.projects.get(id) ?? null;
  };
  invoiceCache = async (id: string) => this.invoiceCaches.get(id) ?? null;
  paymentCache = async (id: string) => this.paymentCaches.get(id) ?? null;
  installmentCache = async (id: string) => this.installmentCaches.get(id) ?? null;
  recurringChargeCache = async (id: string) => this.chargeCaches.get(id) ?? null;
  recurringExpenseCache = async (id: string) => this.recurringExpenseCaches.get(id) ?? null;
  allIds = async () => this.ids;
}

/** In-memory `ReadModelWriterPort`; `calls` records the order of the writes. */
export class InMemoryReadModelWriter implements ReadModelWriterPort {
  facts = new Map<string, FactRow[]>();
  clientMetrics = new Map<
    string,
    ClientMoneyColumns & { projectCount: number; lastActivityAt: Date | null }
  >();
  projectMetrics = new Map<string, ProjectMoneyColumns>();
  balances = new Map<string, { balance: string; at: Date }>();
  invoiceCaches = new Map<string, InvoiceCacheWrite>();
  paymentCaches = new Map<
    string,
    { allocatable: string; netCredited: string; unallocated: string }
  >();
  installmentStatuses = new Map<string, InstallmentStatus>();
  chargeMonthly = new Map<string, string>();
  recurringExpenseMonthly = new Map<string, string>();
  constructor(readonly calls: string[] = []) {}

  async replaceFacts(sourceType: FinanceFactSource, sourceId: string, facts: readonly FactRow[]) {
    this.calls.push(`facts:${sourceType}:${sourceId}`);
    this.facts.set(`${sourceType}:${sourceId}`, [...facts]);
  }
  async clearFacts() {
    this.calls.push('clearFacts');
    this.facts.clear();
  }
  async lockClientMetrics(clientIds: readonly string[]) {
    this.calls.push(`lockClients:${clientIds.join(',')}`);
  }
  async lockProjectMetrics(projectIds: readonly string[]) {
    this.calls.push(`lockProjects:${projectIds.join(',')}`);
  }
  async writeClientMetrics(clientId: string, columns: ClientMoneyColumns) {
    this.calls.push(`client:${clientId}`);
    const current = this.clientMetrics.get(clientId);
    this.clientMetrics.set(clientId, {
      projectCount: current?.projectCount ?? 0,
      lastActivityAt: current?.lastActivityAt ?? null,
      ...columns,
    });
  }
  async writeProjectMetrics(projectId: string, columns: ProjectMoneyColumns) {
    this.calls.push(`project:${projectId}`);
    this.projectMetrics.set(projectId, columns);
  }
  async writeAccountBalance(accountId: string, balance: string, at: Date) {
    this.calls.push(`account:${accountId}`);
    this.balances.set(accountId, { balance, at });
  }
  async writeInvoiceCache(invoiceId: string, cache: InvoiceCacheWrite) {
    this.calls.push(`invoiceCache:${invoiceId}`);
    this.invoiceCaches.set(invoiceId, cache);
  }
  async writePaymentCache(
    paymentId: string,
    cache: { allocatable: string; netCredited: string; unallocated: string },
  ) {
    this.calls.push(`paymentCache:${paymentId}`);
    this.paymentCaches.set(paymentId, cache);
  }
  async writeInstallmentStatus(installmentId: string, status: InstallmentStatus) {
    this.calls.push(`installment:${installmentId}`);
    this.installmentStatuses.set(installmentId, status);
  }
  async writeRecurringChargeMonthlyUsd(id: string, monthlyAmountUsd: string) {
    this.calls.push(`charge:${id}`);
    this.chargeMonthly.set(id, monthlyAmountUsd);
  }
  async writeRecurringExpenseMonthlyUsd(id: string, monthlyAmountUsd: string) {
    this.calls.push(`recurringExpense:${id}`);
    this.recurringExpenseMonthly.set(id, monthlyAmountUsd);
  }
}
