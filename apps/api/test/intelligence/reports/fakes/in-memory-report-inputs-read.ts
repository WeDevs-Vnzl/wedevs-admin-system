import type { DateOnly } from '../../../../src/shared/domain/business-date';
import { addMoney, sumMoney, type MoneyString } from '../../../../src/shared/domain/money';
import type {
  AccountBalanceRow,
  AccountFlowRow,
  CategoryMonthRow,
  ClientCollectionDay,
  KpiClientRow,
  KpiProjectRow,
  LabelKind,
  LabelRow,
  ProjectFlowRow,
  ReceivableClose,
  RecurringChargeRow,
  RecurringExpenseRow,
  ReportInputsReadPort,
  ReportScope,
  ScopeRecordKind,
  TaxesByMonth,
} from '../../../../src/modules/intelligence/application/ports/report-inputs-read.port';
import { monthsOf, type DateRange } from '../../../../src/modules/intelligence/domain/report-range';

/** A project's collected and spent money on one day, the seed of `projectFlows`. */
export type ProjectDay = {
  projectId: string;
  date: DateOnly;
  collectedUsd: MoneyString;
  expensesUsd: MoneyString;
};

/** An open invoice by due date: it counts at every close from `issueDate` on while `balanceUsd` is open. */
export type OpenInvoice = { issueDate: DateOnly; dueDate: DateOnly; balanceUsd: MoneyString };

/**
 * Fake `ReportInputsReadPort` over seeded rows. Scopes are recorded, not applied (the SQL adapter's
 * integration test and the e2e prove the narrowing); `calls` counts port calls per method.
 */
export class InMemoryReportInputsRead implements ReportInputsReadPort {
  readonly existing: Record<ScopeRecordKind, Set<string>> = {
    CLIENT: new Set(),
    PROJECT: new Set(),
    TAG: new Set(),
  };
  readonly labelRows: Record<LabelKind, LabelRow[]> = {
    CLIENT: [],
    PROJECT: [],
    ACCOUNT: [],
    TECHNOLOGY: [],
    CATEGORY: [],
    METHOD: [],
  };
  categoryMonths: CategoryMonthRow[] = [];
  accountFlows: AccountFlowRow[] = [];
  taxes: TaxesByMonth = { rates: [], withholdings: [] };
  openInvoices: OpenInvoice[] = [];
  collections: ClientCollectionDay[] = [];
  projectDays: ProjectDay[] = [];
  charges: RecurringChargeRow[] = [];
  recurringExpenseRows: RecurringExpenseRow[] = [];
  balances: AccountBalanceRow[] = [];
  projects: KpiProjectRow[] = [];
  clients: KpiClientRow[] = [];

  readonly calls: Record<string, number> = {};
  readonly scopes: ReportScope[] = [];

  private count(method: string, scope?: ReportScope): void {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (scope) this.scopes.push(scope);
  }

  get totalCalls(): number {
    return Object.values(this.calls).reduce((sum, n) => sum + n, 0);
  }

  async exists(kind: ScopeRecordKind, id: string): Promise<boolean> {
    this.count('exists');
    return this.existing[kind].has(id);
  }

  async labels(kind: LabelKind, ids: readonly string[]): Promise<LabelRow[]> {
    this.count('labels');
    return this.labelRows[kind].filter((row) => ids.includes(row.id));
  }

  async expensesByMonthCategory(range: DateRange, scope: ReportScope): Promise<CategoryMonthRow[]> {
    this.count('expensesByMonthCategory', scope);
    return this.categoryMonths.filter((row) => monthsOf(range).includes(row.month));
  }

  async accountFlow(range: DateRange, scope: ReportScope): Promise<AccountFlowRow[]> {
    this.count('accountFlow', scope);
    return this.accountFlows.filter((row) => monthsOf(range).includes(row.month));
  }

  async taxesByMonth(range: DateRange, scope: ReportScope): Promise<TaxesByMonth> {
    this.count('taxesByMonth', scope);
    const months = monthsOf(range);
    return {
      rates: this.taxes.rates.filter((row) => months.includes(row.month)),
      withholdings: this.taxes.withholdings.filter((row) => months.includes(row.month)),
    };
  }

  async receivableAt(closes: readonly DateOnly[], scope: ReportScope): Promise<ReceivableClose[]> {
    this.count('receivableAt', scope);
    return closes.map((close) => {
      const open = this.openInvoices.filter((row) => row.issueDate <= close);
      return {
        close,
        totalUsd: sumMoney(open.map((row) => row.balanceUsd)),
        overdueUsd: sumMoney(
          open.filter((row) => row.dueDate < close).map((row) => row.balanceUsd),
        ),
      };
    });
  }

  async collectionsByClientDay(upTo: DateOnly, scope: ReportScope): Promise<ClientCollectionDay[]> {
    this.count('collectionsByClientDay', scope);
    return this.collections.filter((row) => row.date <= upTo);
  }

  async projectFlows(windows: readonly DateRange[], scope: ReportScope): Promise<ProjectFlowRow[]> {
    this.count('projectFlows', scope);
    const rows: ProjectFlowRow[] = [];
    windows.forEach((window, index) => {
      const sums = new Map<string, { collected: MoneyString; expenses: MoneyString }>();
      for (const day of this.projectDays) {
        if (day.date < window.from || day.date > window.to) continue;
        const entry = sums.get(day.projectId) ?? { collected: '0.00', expenses: '0.00' };
        sums.set(day.projectId, {
          collected: addMoney(entry.collected, day.collectedUsd),
          expenses: addMoney(entry.expenses, day.expensesUsd),
        });
      }
      for (const [projectId, entry] of sums) {
        rows.push({
          window: index,
          projectId,
          collectedUsd: entry.collected,
          expensesUsd: entry.expenses,
        });
      }
    });
    return rows;
  }

  async recurringCharges(scope: ReportScope): Promise<RecurringChargeRow[]> {
    this.count('recurringCharges', scope);
    return this.charges;
  }

  async recurringExpenses(scope: ReportScope): Promise<RecurringExpenseRow[]> {
    this.count('recurringExpenses', scope);
    return this.recurringExpenseRows;
  }

  async accountBalances(): Promise<AccountBalanceRow[]> {
    this.count('accountBalances');
    return this.balances;
  }

  async kpiProjects(scope: ReportScope): Promise<KpiProjectRow[]> {
    this.count('kpiProjects', scope);
    return this.projects;
  }

  async kpiClients(scope: ReportScope): Promise<KpiClientRow[]> {
    this.count('kpiClients', scope);
    return this.clients;
  }
}
