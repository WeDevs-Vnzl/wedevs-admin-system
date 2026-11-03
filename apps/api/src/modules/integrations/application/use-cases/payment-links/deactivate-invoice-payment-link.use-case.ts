import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain';
import { deactivateLink, type PaymentLink } from '../../../domain/payment-link';
import type { PaymentLinkRepository } from '../../ports/payment-link.repository.port';
import type { PaymentProviderPort } from '../../ports/payment-provider.port';
import {
  MANUAL_DEACTIVATION_REASON,
  toPaymentLinkOutput,
  type PaymentLinkOutput,
} from './payment-link-support';

export interface DeactivateInvoicePaymentLinkInput {
  readonly invoiceId: string;
  readonly linkId: string;
}

/**
 * `DeactivateInvoicePaymentLink` (choice 5): `payment` `create`. The row becomes `DEACTIVATED` in a unit of
 * work under the `Invoice` lock, then the provider call runs outside it. Idempotent: an already deactivated
 * link only repeats the (idempotent) provider call, so a call that failed earlier is retried by asking
 * again. A `COMPLETED` or `SETTLED` link cannot be deactivated (`CONFLICT`).
 */
export class DeactivateInvoicePaymentLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly links: PaymentLinkRepository,
    private readonly provider: PaymentProviderPort,
    private readonly locks: RowLocksPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: DeactivateInvoicePaymentLinkInput,
  ): Promise<PaymentLinkOutput> {
    assertCan(this.authorization, actor, 'create', 'payment');
    const link = await this.uow.run(() => this.close(actor, input), { isolation: 'Serializable' });
    if (link.externalId !== null) {
      await this.provider.deactivatePaymentLink(link.externalId);
      // Confirmed: the daily step no longer owes this link a provider call.
      await this.links.markProviderDeactivated(link.id, this.clock.now());
    }
    return toPaymentLinkOutput(link);
  }

  private async close(
    actor: CurrentUser,
    input: DeactivateInvoicePaymentLinkInput,
  ): Promise<PaymentLink> {
    await this.locks.lock({ Invoice: [input.invoiceId] });
    const current = await this.links.findById(input.linkId);
    if (!current || current.invoiceId !== input.invoiceId) throw new NotFoundError();
    if (current.status === 'DEACTIVATED') return current;

    const off = deactivateLink(current, MANUAL_DEACTIVATION_REASON, this.clock.now());
    await this.links.save(off);
    await this.activityLog.record({
      actor: actorOf(actor),
      action: 'UPDATE',
      entityType: 'PAYMENT_LINK',
      entityId: off.id,
      entityLabel: `${off.amount} ${off.currency}`,
      changes: { status: [current.status, off.status] },
      metadata: { invoiceId: off.invoiceId, reason: MANUAL_DEACTIVATION_REASON },
    });
    return off;
  }
}
