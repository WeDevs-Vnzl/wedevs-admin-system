import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../../shared/domain/domain-error';
import { compareMoney, sumMoney } from '../../../../../shared/domain/money';
import { INVOICE_ERRORS } from '../../../domain/errors';
import type { InvoiceRecord } from '../../ports/invoice.repository.port';
import { headerOf } from './create-invoice.use-case';
import { invalid, type InvoiceInput } from './invoice-input';
import {
  INVOICE_ACTIVITY_FIELDS,
  type InvoiceOutput,
  type InvoiceSupport,
} from './invoice-support';

export type UpdateInvoiceInput = InvoiceInput & { readonly id: string };

/**
 * `updateInvoice` (HU-11, HU-29 CA1): the whole invoice again, lines replaced. A voided or archived invoice is
 * read-only. One with live allocations keeps its client and currency (`INTEGRITY_LOCK`) and its receivable
 * cannot drop below what is allocated. The payments allocated to it are locked and their facts re-projected,
 * because a payment's collected facts follow the projects of the invoice lines.
 */
export class UpdateInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, raw: UpdateInvoiceInput): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'update', 'invoice');
    const input = await this.support.prepare(raw);
    if (!(await this.support.invoices.findById(raw.id))) throw new NotFoundError();
    const plan = await this.support.plan({
      invoiceId: raw.id,
      clientIds: [input.clientId],
      projectIds: input.lines.map((line) => line.projectId),
      installmentIds: input.lines.map((line) => line.installmentId),
    });

    await this.uow.run(
      async () => {
        const locked = await this.support.lockPlan(plan);
        const before = await this.support.invoices.findById(raw.id);
        if (!before) throw new NotFoundError();
        if (before.archivedAt !== null) throw invalid('id', INVOICE_ERRORS.archived);
        if (before.voidedAt !== null) throw new ConflictError({ message: INVOICE_ERRORS.voided });
        await this.support.assertNumberFree(input.invoiceNumber, before.id);
        const client = await this.support.requireClient(input.clientId);

        const allocations = await this.support.invoices.liveAllocations(before.id);
        if (
          allocations.length > 0 &&
          (client.id !== before.clientId || input.currency !== before.currency)
        ) {
          throw new IntegrityLockedError({ message: INVOICE_ERRORS.clientLocked });
        }

        const lines = await this.support.resolveLines(
          client.id,
          input,
          before.id,
          before.lines,
          this.ids,
        );
        const { columns } = this.support.derive(input, lines, allocations, { voided: false });
        const allocated = sumMoney(allocations.map((a) => a.amountInvoiceCurrency));
        if (compareMoney(columns.receivable, allocated) < 0) {
          throw new IntegrityLockedError({ message: INVOICE_ERRORS.receivableBelowPaid });
        }
        const fileId = input.fileId === undefined ? before.fileId : input.fileId;
        if (fileId !== null && fileId !== before.fileId) {
          await this.support.reserveFile(actor, fileId);
        }

        const after: InvoiceRecord = {
          ...before,
          ...headerOf(input),
          ...columns,
          fileId,
          lines,
          updatedAt: this.support.nowIso(),
          updatedById: actor.userId,
        };
        await this.support.invoices.update(after);
        await this.support.project(before, after, locked.paymentIds);
        const changes = diffFields(
          { ...before },
          { ...after },
          { fields: INVOICE_ACTIVITY_FIELDS },
        );
        await this.support.record(actorOf(actor), 'UPDATE', before, after, { changes });
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(raw.id);
  }
}
