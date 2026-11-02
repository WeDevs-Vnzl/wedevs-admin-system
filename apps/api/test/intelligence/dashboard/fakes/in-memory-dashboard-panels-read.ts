import type { DateOnly } from '../../../../src/shared/domain/business-date';
import type {
  AccountBalanceRow,
  ClientMetricsRecord,
  DashboardPanelsReadPort,
  DueInvoiceRow,
  ExpiringDocumentRow,
  InstallmentDueRow,
  ProjectMetricsRecord,
  RecentActivityRow,
  RecurringChargeRow,
  UpcomingRecurringExpenseRow,
} from '../../../../src/modules/intelligence/application/ports/dashboard-panels-read.port';

export type SeedCharge = RecurringChargeRow & { startDate: DateOnly; endDate?: DateOnly | null };

/** Fake panels port: seeded rows, with the date windows of the SQL adapter applied on read. */
export class InMemoryDashboardPanelsRead implements DashboardPanelsReadPort {
  invoices: DueInvoiceRow[] = [];
  installments: InstallmentDueRow[] = [];
  documents: ExpiringDocumentRow[] = [];
  recurringExpenses: UpcomingRecurringExpenseRow[] = [];
  activity: RecentActivityRow[] = [];
  charges: SeedCharge[] = [];
  accounts: AccountBalanceRow[] = [];
  clients = new Map<string, ClientMetricsRecord>();
  projects = new Map<string, ProjectMetricsRecord>();
  /** Counts the reads, so a test can prove a rejected request touched nothing. */
  reads = 0;

  async invoicesDue(limit: number) {
    this.reads += 1;
    return [...this.invoices]
      .sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) ||
          (a.invoice.code ?? '').localeCompare(b.invoice.code ?? ''),
      )
      .slice(0, limit);
  }

  async installmentsToInvoice(until: DateOnly) {
    this.reads += 1;
    return this.installments.filter((row) => row.dueDate !== null && row.dueDate <= until);
  }

  async documentsExpiring(from: DateOnly, until: DateOnly) {
    this.reads += 1;
    return this.documents.filter((row) => row.expiresAt >= from && row.expiresAt <= until);
  }

  async upcomingRecurringExpenses(until: DateOnly) {
    this.reads += 1;
    return this.recurringExpenses.filter((row) => row.dueDate <= until);
  }

  async recentActivity(limit: number) {
    this.reads += 1;
    return [...this.activity]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async recurringChargesAt(date: DateOnly) {
    this.reads += 1;
    return this.charges
      .filter((c) => c.startDate <= date && (c.endDate == null || c.endDate >= date))
      .map(({ monthlyAmountUsd, status }) => ({ monthlyAmountUsd, status }));
  }

  async activeAccountBalances() {
    this.reads += 1;
    return this.accounts;
  }

  async clientMetrics(clientId: string) {
    this.reads += 1;
    return this.clients.get(clientId) ?? null;
  }

  async projectMetrics(projectId: string) {
    this.reads += 1;
    return this.projects.get(projectId) ?? null;
  }
}
