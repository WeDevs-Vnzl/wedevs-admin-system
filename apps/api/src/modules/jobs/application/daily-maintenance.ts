import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { JobRunner, stepOf, type JobRunResult, type SystemUseCase } from './job-runner';

export const DAILY_MAINTENANCE = 'daily-maintenance';

interface Skippable {
  readonly skippedIds: readonly string[];
}
type Updated = Skippable & { readonly updated: number };
type Created = Skippable & { readonly created: number };
interface LinkDeactivations {
  readonly deactivated: readonly string[];
  readonly skippedInvoiceIds: readonly string[];
  readonly providerFailures: readonly string[];
}

export interface DailyMaintenanceSteps {
  readonly markOverdueInvoices: SystemUseCase<Updated>;
  readonly markExpiredDocuments: SystemUseCase<Updated>;
  readonly generateRecurringInstallments: SystemUseCase<Created>;
  readonly generateRecurringExpenses: SystemUseCase<Created>;
  readonly markExpiredShareLinks: SystemUseCase<Updated>;
  /** DT-196, last step. Absent while Stripe is off: the job then runs the other five unchanged. */
  readonly deactivatePaymentLinks?: SystemUseCase<LinkDeactivations>;
}

const updated = (r: Updated) => ({ counts: { updated: r.updated, skipped: r.skippedIds.length } });
const created = (r: Created) => ({ counts: { created: r.created, skipped: r.skippedIds.length } });
const deactivations = (r: LinkDeactivations) => ({
  counts: {
    deactivated: r.deactivated.length,
    skipped: r.skippedInvoiceIds.length,
    providerFailures: r.providerFailures.length,
  },
});

/**
 * PRD §12 `daily-maintenance`, in the documented order: overdue invoices, document expiry, recurring
 * installments, recurring expenses, expired share links, then (Stripe configured) the payment links the balance no
 * longer covers (DT-196). Every step is a `SYSTEM` use case; the runner keeps
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
      ...(s.deactivatePaymentLinks
        ? [stepOf('deactivate-payment-links', s.deactivatePaymentLinks, deactivations)]
        : []),
    ]);
  }
}
