import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { computeInstallmentStatus } from '../../../domain/installments';
import type { BillingRepository } from '../../ports/billing.repository.port';

/**
 * `recomputeInstallmentStatus` (PRD §12): the stored status of installments from the invoices that reference
 * them, by the domain's `computeInstallmentStatus` (§8.4.2). Invoice and payment mutations call it with the
 * installments of their lines, inside their own unit of work and after they took their locks (the
 * `BillingInstallment` rows precede `Invoice` in the global order); it never opens an isolation and never
 * locks. Returns the ids whose status changed.
 */
export class RecomputeInstallmentStatus {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly repository: BillingRepository,
  ) {}

  async execute(installmentIds: readonly string[]): Promise<string[]> {
    const ids = [...new Set(installmentIds)];
    if (ids.length === 0) return [];
    return this.uow.run(async () => {
      const changed: string[] = [];
      for (const state of await this.repository.installmentInvoiceStates(ids)) {
        const status = computeInstallmentStatus({
          cancelled: state.cancelled,
          invoices: state.invoices,
        });
        if (status === state.status) continue;
        await this.repository.setInstallmentStatus(state.id, status);
        changed.push(state.id);
      }
      return changed;
    });
  }
}
