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
import { PROVIDER_RETRY_WINDOW_MS, openLinksOf, reservedOf } from './payment-link-support';

export interface DeactivateLinksResult {
  /** Links this run moved to `DEACTIVATED`. */
  readonly deactivated: readonly string[];
  /** Invoices a `CONFLICT` left for the next run (DT-129). */
  readonly skippedInvoiceIds: readonly string[];
  /** Links whose provider call failed; their row is already `DEACTIVATED` and the next run retries the call. */
  readonly providerFailures: readonly string[];
}

/**
 * `DeactivatePaymentLinksBeyondBalance` (DT-196): the last step of the daily maintenance, `SYSTEM` only. Per
 * invoice with open links, under its `Invoice` lock: `linksToDeactivate` decides (an invoice no longer open
 * loses every open link, `PENDING` rows older than 24 hours go, then the newest links until the sum fits),
 * the rows become `DEACTIVATED` with an activity entry each and the unit of work commits. Only then the
 * provider calls run. A provider failure leaves the row `DEACTIVATED`; the next run repeats the call for
 * links deactivated within the retry window. A `ConflictError` skips the invoice until the next run.
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
        const { changed, toCall } = await this.uow.run(() => this.reduce(invoiceId), {
          isolation: 'Serializable',
        });
        deactivated.push(...changed.map((link) => link.id));
        for (const link of toCall) {
          if (!(await this.callProvider(link))) failures.push(link.id);
        }
      } catch (error) {
        // Only a conflict: a busy invoice must not abort the rest of the run.
        if (!(error instanceof ConflictError)) throw error;
        skipped.push(invoiceId);
      }
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
    // Retry the calls that failed earlier: deactivated recently, already known to the provider.
    const cutoff = now.getTime() - PROVIDER_RETRY_WINDOW_MS;
    const retries = all.filter(
      (link) =>
        link.status === 'DEACTIVATED' &&
        link.deactivatedAt !== null &&
        link.deactivatedAt.getTime() >= cutoff,
    );
    const toCall = [...changed, ...retries].filter((link) => link.externalId !== null);
    return { changed, toCall };
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
      return true;
    } catch {
      return false;
    }
  }
}
