import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { RowLockSet } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import type { BillingProjectsPort } from '../../ports/billing-projects.port';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { BillingProjector } from './billing-transaction';

export interface ProjectCancelOptions {
  readonly cancelPendingInstallments: boolean;
  readonly finishRecurringCharges: boolean;
}

export interface ProjectCancelResult {
  readonly installments: number;
  readonly recurringCharges: number;
}

/**
 * Billing's exported application API for `commercial` (package 6.3 rebinds `ProjectBillingPort` to it, Q-BE2-1).
 * Structurally the same methods as that port, plus `lockSet`.
 *
 * `cancelForProject` joins the caller's unit of work and never opens an isolation or a second `lock` call (a
 * second call in one transaction is a programming error): the caller must have locked, in its single
 * `RowLocksPort.lock`, the project, its clients and the rows `lockSet(projectId)` names. It cancels the
 * `PENDIENTE` unbilled installments and finishes the live recurring charges as chosen (HU-08 CA3), then
 * projects the project's clients and the project (the monthly recurring and adjustments feed
 * `ProjectMetrics`). The status entry of the caller carries the counts in its metadata.
 */
export class ProjectBillingApi {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly repository: BillingRepository,
    private readonly projects: BillingProjectsPort,
    private readonly projector: BillingProjector,
    private readonly clock: ClockPort,
  ) {}

  /** Open installments, a live recurring charge or an issued invoice: archiving needs `confirm`. */
  hasActiveBilling(projectId: string): Promise<boolean> {
    return this.repository.hasActiveBilling(projectId);
  }

  async hasBillingPlan(projectId: string): Promise<boolean> {
    return (await this.repository.findPlan(projectId)) !== null;
  }

  hasActiveRecurringCharge(projectId: string): Promise<boolean> {
    return this.repository.hasActiveCharge(projectId);
  }

  /** The billing rows `cancelForProject` writes, for the caller's single lock call (global lock order). */
  async lockSet(
    projectId: string,
  ): Promise<Pick<RowLockSet, 'RecurringCharge' | 'BillingInstallment'>> {
    const ids = await this.repository.billingIdsOf(projectId);
    return { RecurringCharge: ids.recurringChargeIds, BillingInstallment: ids.installmentIds };
  }

  async cancelForProject(
    projectId: string,
    options: ProjectCancelOptions,
  ): Promise<ProjectCancelResult> {
    return this.uow.run(async () => {
      const now = this.clock.now();
      let installments = 0;
      let recurringCharges = 0;

      if (options.cancelPendingInstallments) {
        const pending = (await this.repository.listInstallments(projectId))
          .filter(
            (item) => item.status === 'PENDIENTE' && item.cancelledAt === null && !item.locked,
          )
          .map((item) => item.id);
        if (pending.length > 0) await this.repository.cancelInstallments(pending, now);
        installments = pending.length;
      }
      if (options.finishRecurringCharges) {
        const today = todayInCaracas(now);
        for (const charge of await this.repository.listCharges(projectId)) {
          if (charge.status === 'FINALIZADO') continue;
          await this.repository.updateCharge(
            charge.id,
            {
              status: 'FINALIZADO',
              ...(charge.endDate === null || charge.endDate > today ? { endDate: today } : {}),
            },
            now,
          );
          recurringCharges += 1;
        }
      }
      if (installments > 0 || recurringCharges > 0) {
        const project = await this.projects.liveProject(projectId);
        await this.projector.projectClients(project?.clientIds ?? []);
        await this.projector.projectProjects([projectId]);
      }
      return { installments, recurringCharges };
    });
  }
}
