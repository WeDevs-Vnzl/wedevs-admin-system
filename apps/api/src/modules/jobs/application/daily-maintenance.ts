import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { JobRunner, stepOf, type JobRunResult, type SystemUseCase } from './job-runner';

export const DAILY_MAINTENANCE = 'daily-maintenance';

interface Skippable {
  readonly skippedIds: readonly string[];
}
type Updated = Skippable & { readonly updated: number };
type Created = Skippable & { readonly created: number };

export interface DailyMaintenanceSteps {
  readonly markOverdueInvoices: SystemUseCase<Updated>;
  readonly markExpiredDocuments: SystemUseCase<Updated>;
  readonly generateRecurringInstallments: SystemUseCase<Created>;
  readonly generateRecurringExpenses: SystemUseCase<Created>;
  readonly markExpiredShareLinks: SystemUseCase<Updated>;
}

const updated = (r: Updated) => ({ counts: { updated: r.updated, skipped: r.skippedIds.length } });
const created = (r: Created) => ({ counts: { created: r.created, skipped: r.skippedIds.length } });

/**
 * PRD §12 `daily-maintenance`, in the documented order: overdue invoices, document expiry, recurring
 * installments, recurring expenses, expired share links. Every step is a `SYSTEM` use case; the runner keeps
 * the order, isolates failures and writes the per-step summary (A3, A4).
 */
export class DailyMaintenance {
  constructor(
    private readonly runner: JobRunner,
    private readonly steps: DailyMaintenanceSteps,
  ) {}

  execute(): Promise<JobRunResult> {
    const s = this.steps;
    return this.runner.run(SYSTEM_ACTOR, DAILY_MAINTENANCE, [
      stepOf('mark-overdue-invoices', s.markOverdueInvoices, updated),
      stepOf('mark-expired-documents', s.markExpiredDocuments, updated),
      stepOf('generate-recurring-installments', s.generateRecurringInstallments, created),
      stepOf('generate-recurring-expenses', s.generateRecurringExpenses, created),
      stepOf('mark-expired-share-links', s.markExpiredShareLinks, updated),
    ]);
  }
}
