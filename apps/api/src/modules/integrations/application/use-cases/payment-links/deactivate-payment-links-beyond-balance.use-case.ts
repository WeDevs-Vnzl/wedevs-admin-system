import { SYSTEM_ACTOR, type Actor } from '../../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../../shared/domain';
import { linksToDeactivate } from '../../../domain/link-capacity';
import { deactivateLink, type PaymentLink } from '../../../domain/payment-link';
import type { InvoiceForLink, InvoiceForLinkPort } from '../../ports/invoice-for-link.port';
import type { PaymentLinkRepository } from '../../ports/payment-link.repository.port';
import type { PaymentProviderPort } from '../../ports/payment-provider.port';
import { openLinksOf, reservedOf } from './payment-link-support';

export interface DeactivateLinksResult {
  /** Links this run moved to `DEACTIVATED`. */
  readonly deactivated: readonly string[];
  /** Invoices a `CONFLICT` left for the next run (DT-129). */
  readonly skippedInvoiceIds: readonly string[];
  /** Links whose provider call failed; their row is already `DEACTIVATED` and every later run retries the call. */
  readonly providerFailures: readonly string[];
}

/**
 * `DeactivatePaymentLinksBeyondBalance` (DT-196): the last step of the daily maintenance, `SYSTEM` only. Per
 * invoice with open links, under its `Invoice` lock: `linksToDeactivate` decides (an invoice no longer open
 * loses every open link, `PENDING` and `ACTIVE` rows older than 24 hours go (the Checkout Session expired), then the newest links until the sum fits),
 * the rows become `DEACTIVATED` with an activity entry each and the unit of work commits. Only then the
 * provider calls run for every link whose provider deactivation is still owed (the ones just deactivated and
 * the ones an earlier run failed on), each confirmed on success. A provider failure leaves the row
 * `DEACTIVATED` and unconfirmed: every later run repeats the call until it succeeds, whether or not the
 * invoice still has an open link. A `ConflictError` skips the invoice until the next run.
 */
export class DeactivatePaymentLinksBeyondBalance {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly invoices: InvoiceForLinkPort,
    private readonly links: PaymentLinkRepository,
    private readonly provider: PaymentProviderPort,
    private readonly locks: RowLocksPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor): Promise<DeactivateLinksResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const deactivated: string[] = [];
    const skipped: string[] = [];
    const failures: string[] = [];
    for (const invoiceId of await this.links.listInvoiceIdsWithOpenLinks()) {
      try {
        const changed = await this.uow.run(() => this.reduce(invoiceId), {
          isolation: 'Serializable',
        });
        deactivated.push(...changed.map((link) => link.id));
      } catch (error) {
        // Only a conflict: a busy invoice must not abort the rest of the run.
        if (!(error instanceof ConflictError)) throw error;
        skipped.push(invoiceId);
      }
    }
    // This run's deactivations go first, newest link first as decided; older owed calls follow.
    const order = new Map(deactivated.map((id, index) => [id, index]));
    const owed = [...(await this.links.listPendingProviderDeactivation())].sort(
      (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
    );
    for (const link of owed) {
      if (!(await this.callProvider(link))) failures.push(link.id);
    }
    return { deactivated, skippedInvoiceIds: skipped, providerFailures: failures };
  }

  private async reduce(invoiceId: string) {
    await this.locks.lock({ Invoice: [invoiceId] });
    const invoice = await this.findInvoice(invoiceId);
    const all = await this.links.listByInvoice(invoiceId);
    const now = this.clock.now();
    const plan = linksToDeactivate(
      invoice?.openBalance ?? '0.00',
      openLinksOf(all),
      reservedOf(all),
      { invoiceOpen: invoice?.open ?? false, now },
    );
    const byId = new Map(all.map((link) => [link.id, link]));
    const changed: PaymentLink[] = [];
    for (const { linkId, reason } of plan) {
      const current = byId.get(linkId);
      if (!current) continue;
      const off = deactivateLink(current, reason, now);
      await this.links.save(off);
      await this.activityLog.record({
        actor: SYSTEM_ACTOR,
        action: 'UPDATE',
        entityType: 'PAYMENT_LINK',
        entityId: off.id,
        entityLabel: `${off.amount} ${off.currency}`,
        changes: { status: [current.status, off.status] },
        metadata: { invoiceId, reason },
      });
      changed.push(off);
    }
    return changed;
  }

  /** An invoice that no longer resolves (deleted) is treated as not open. */
  private async findInvoice(invoiceId: string): Promise<InvoiceForLink | null> {
    try {
      return await this.invoices.load(invoiceId);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  private async callProvider(link: PaymentLink): Promise<boolean> {
    try {
      await this.provider.deactivatePaymentLink(link.externalId as string);
      await this.links.markProviderDeactivated(link.id, this.clock.now());
      return true;
    } catch {
      return false;
    }
  }
}
