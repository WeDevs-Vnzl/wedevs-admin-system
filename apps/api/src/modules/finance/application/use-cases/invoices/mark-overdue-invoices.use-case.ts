import type { Actor } from '../../../../../shared/application/actor';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ForbiddenError } from '../../../../../shared/domain/domain-error';
import type { InvoiceRepository } from '../../ports/invoice.repository.port';
import { todayOf, type InvoiceSupport } from './invoice-support';

export interface MarkOverdueResult {
  readonly updated: number;
  readonly invoiceIds: readonly string[];
}

/**
 * Step 1 of `daily-maintenance` (PRD §12, HU-12 CA4): every issued invoice whose due date passed becomes
 * `VENCIDA`. No route: BE-5 schedules it under a `SYSTEM` actor and anything else is `FORBIDDEN`. Each invoice
 * has its own `Serializable` unit of work that locks it with its client and projects first, recomputes its
 * status from its lines and allocations (a payment that landed meanwhile wins) and projects its client and
 * projects. Running it twice on the same day changes nothing the second time.
 */
export class MarkOverdueInvoices {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly invoices: InvoiceRepository,
    private readonly support: InvoiceSupport,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor): Promise<MarkOverdueResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const candidates = await this.invoices.overdueIds(todayOf(this.clock));
    const updated: string[] = [];
    for (const id of candidates) {
      if (await this.markOne(actor, id)) updated.push(id);
    }
    return { updated: updated.length, invoiceIds: updated };
  }

  private async markOne(actor: Actor, id: string): Promise<boolean> {
    const plan = await this.support.plan({ invoiceId: id });
    return this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.invoices.findById(id);
        if (
          !before ||
          before.archivedAt !== null ||
          before.isDraft ||
          !['EMITIDA', 'PARCIAL'].includes(before.status)
        ) {
          return false;
        }
        const after = await this.support.rederive(before);
        if (after.status === before.status) return false;

        await this.invoices.update({ ...after, updatedAt: this.support.nowIso() });
        await this.support.project(before, after, locked.paymentIds);
        await this.support.logOnly(actor, 'SYSTEM_JOB', after, {
          metadata: { from: before.status, to: after.status },
        });
        return true;
      },
      { isolation: 'Serializable' },
    );
  }
}
