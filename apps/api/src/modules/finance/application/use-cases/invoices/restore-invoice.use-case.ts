import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { addMoney, compareMoney } from '../../../../../shared/domain/money';
import { INVOICE_ERRORS } from '../../../domain/errors';
import type { InvoiceRecord } from '../../ports/invoice.repository.port';
import type { InvoiceSupport } from './invoice-support';

/** Message keys of the trash (`trash.errors.*`, the mock's `trash.ts` `MESSAGES`). */
export const RESTORE_ERRORS = {
  invoiceNumberTaken: 'trash.errors.invoiceNumberTaken',
  clientArchived: 'trash.errors.clientArchived',
} as const;

export interface RestoredInvoice {
  readonly entity: EntityRef;
  readonly restoredAt: Date;
}

/**
 * `POST /invoices/{id}/restore` and the trash handler of `INVOICE` (HU-28 CA2). An archived invoice comes back
 * only if nothing it needs changed meanwhile: its client is live, nobody else holds its number
 * (`trash.errors.invoiceNumberTaken`, pointing at the holder) and no installment it bills would end up
 * over-billed or cancelled. The mock freed archived invoices from the over-billing check, so restoring could
 * over-bill; here `invoices.errors.installmentExceeded` is a `CONFLICT`. A voided invoice binds no installment
 * and skips that check. The status is recomputed (it may be overdue by now) and the facts and metrics return
 * in the same unit of work.
 */
export class RestoreInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<RestoredInvoice> {
    assertCan(this.authorization, actor, 'restore', 'invoice');
    const first = await this.support.invoices.findById(id);
    if (!first || first.archivedAt === null) throw new NotFoundError();
    const plan = await this.support.plan({ invoiceId: id });

    return this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.support.invoices.findById(id);
        if (!before || before.archivedAt === null) throw new NotFoundError();

        const holder = await this.support.invoices.numberHolder(before.invoiceNumber, before.id);
        if (holder) {
          throw new ConflictError({
            message: RESTORE_ERRORS.invoiceNumberTaken,
            entity: {
              type: 'INVOICE',
              id: holder.id,
              code: holder.code,
              label: holder.invoiceNumber,
            },
          });
        }
        await this.requireLiveClient(before);
        if (before.voidedAt === null) await this.requireRoomOnInstallments(before);

        const now = this.support.nowIso();
        const after: InvoiceRecord = await this.support.rederive({
          ...before,
          archivedAt: null,
          archivedById: null,
          updatedAt: now,
          updatedById: actor.userId,
        });
        await this.support.invoices.update(after);
        await this.support.project(before, after, locked.paymentIds);
        await this.support.record(actorOf(actor), 'RESTORE', before, after);
        return {
          entity: { type: 'INVOICE', id: after.id, code: after.code, label: after.invoiceNumber },
          restoredAt: new Date(now),
        };
      },
      { isolation: 'Serializable' },
    );
  }

  private async requireLiveClient(invoice: InvoiceRecord): Promise<void> {
    if (await this.support.liveClientRef(invoice.clientId)) return;
    const view = await this.support.invoices.view(invoice.id);
    throw new ConflictError({
      message: RESTORE_ERRORS.clientArchived,
      ...(view ? { entity: view.client } : {}),
    });
  }

  /** Every installment the invoice bills is live and still has room for it beside the other live invoices. */
  private async requireRoomOnInstallments(invoice: InvoiceRecord): Promise<void> {
    const installmentIds = [
      ...new Set(invoice.lines.flatMap((line) => (line.installmentId ? [line.installmentId] : []))),
    ];
    if (installmentIds.length === 0) return;
    const refs = new Map(
      (await this.support.invoices.installments(installmentIds)).map((ref) => [ref.id, ref]),
    );
    const billed = await this.support.invoices.billedAmounts(installmentIds, invoice.id);
    for (const installmentId of installmentIds) {
      const ref = refs.get(installmentId);
      if (!ref) continue;
      if (ref.cancelled) throw new ConflictError({ message: INVOICE_ERRORS.installmentCancelled });
      const own = invoice.lines
        .filter((line) => line.installmentId === installmentId)
        .reduce((sum, line) => addMoney(sum, line.netAmount), '0.00');
      if (compareMoney(addMoney(billed.get(installmentId) ?? '0.00', own), ref.amount) > 0) {
        throw new ConflictError({ message: INVOICE_ERRORS.installmentExceeded });
      }
    }
  }
}
