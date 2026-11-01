import type { Actor } from '../../../../../shared/application/actor';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ForbiddenError } from '../../../../../shared/domain/domain-error';
import type { InvoiceRepository } from '../../ports/invoice.repository.port';
import { todayOf, type InvoiceSupport } from './invoice-support';

export interface MarkOverdueResult {
  readonly updated: number;
  readonly invoiceIds: readonly string[];
  /** Invoices a `CONFLICT` left for the next run (another transaction held them); the rest was processed. */
  readonly skippedIds: readonly string[];
}

/**
 * Step 1 of `daily-maintenance` (PRD §12, HU-12 CA4): every issued invoice whose due date passed becomes
 * `VENCIDA`, archived ones too (§9.4 has no archived branch, so `RecomputeAll` agrees). No route: BE-5 schedules it under a `SYSTEM` actor and anything else is `FORBIDDEN`. Each invoice
 * has its own `Serializable` unit of work that locks it with its client and projects first, recomputes its
 * status from its lines and allocations (a payment that landed meanwhile wins) and projects its client and
 * projects. An invoice that ends in a `CONFLICT` (a concurrent write, a stale lock plan) is skipped and listed
 * in `skippedIds` for the next run; any other error still aborts the run. The entry of an archived invoice is written without the client scope, so the step moves no
 * client metric and stays out of the client's activity. Running it twice on the same day changes nothing the second time.
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
    const skipped: string[] = [];
    for (const id of candidates) {
      try {
        if (await this.markOne(actor, id)) updated.push(id);
      } catch (error) {
        // Only a conflict: a busy invoice must not abort the rest of the run, the next one picks it up.
        if (!(error instanceof ConflictError)) throw error;
        skipped.push(id);
      }
    }
    return { updated: updated.length, invoiceIds: updated, skippedIds: skipped };
  }

  private async markOne(actor: Actor, id: string): Promise<boolean> {
    const plan = await this.support.plan({ invoiceId: id });
    return this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.invoices.findById(id);
        if (!before || before.isDraft || !['EMITIDA', 'PARCIAL'].includes(before.status)) {
          return false;
        }
        const after = await this.support.rederive(before);
        if (after.status === before.status) return false;

        await this.invoices.update({ ...after, updatedAt: this.support.nowIso() });
        await this.support.project(before, after, locked.paymentIds);
        await this.support.record(actor, 'SYSTEM_JOB', before, after, {
          metadata: { from: before.status, to: after.status },
          clientScope: after.archivedAt === null,
        });
        return true;
      },
      { isolation: 'Serializable' },
    );
  }
}
