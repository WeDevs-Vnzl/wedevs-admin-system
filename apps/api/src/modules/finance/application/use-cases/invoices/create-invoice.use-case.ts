import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { InvoiceRecord } from '../../ports/invoice.repository.port';
import type { InvoiceInput, NormalizedInvoiceInput } from './invoice-input';
import type { InvoiceOutput, InvoiceSupport } from './invoice-support';

/** The header fields an input sets, shared by create and update. */
export function headerOf(input: NormalizedInvoiceInput) {
  return {
    clientId: input.clientId,
    invoiceNumber: input.invoiceNumber,
    controlNumber: input.controlNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    usdRate: input.usdRate,
    bcvRate: input.bcvRate,
    ivaWithheld: input.ivaWithheld,
    islrWithheld: input.islrWithheld,
    otherWithheld: input.otherWithheld,
    otherWithheldNote: input.otherWithheldNote,
    isDraft: input.isDraft,
  };
}

/**
 * `createInvoice` (PRD §8.5, HU-11): an invoice with lines, per-rate tax lines, withholdings and an optional
 * file. `can(create, invoice)` → shape → `Serializable` unit of work: locks (projects, client, installments) →
 * client, number, lines (project, installment and over-billing rules) → totals → file claim → insert →
 * installment status, facts, client and project metrics → search → activity. Every total and the status are
 * derived by the domain (C17), never typed by the caller; the USD snapshots are fixed here (C16).
 */
export class CreateInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: InvoiceSupport,
    private readonly sequence: SequencePort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, raw: InvoiceInput): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'create', 'invoice');
    const input = await this.support.prepare(raw);
    const plan = await this.support.plan({
      clientIds: [input.clientId],
      projectIds: input.lines.map((line) => line.projectId),
      installmentIds: input.lines.map((line) => line.installmentId),
    });

    const id = await this.uow.run(
      async () => {
        await this.support.lockPlan(plan);
        const client = await this.support.requireClient(input.clientId);
        await this.support.assertNumberFree(input.invoiceNumber, null);
        const lines = await this.support.resolveLines(client.id, input, null, [], this.ids);
        const { columns } = this.support.derive(input, lines, [], { voided: false });
        if (input.fileId) await this.support.reserveFile(actor, input.fileId);

        const now = this.support.nowIso();
        const record: InvoiceRecord = {
          id: this.ids.next(),
          code: await this.sequence.next('FAC'),
          ...headerOf(input),
          ...columns,
          voidedAt: null,
          voidReason: null,
          fileId: input.fileId ?? null,
          lines,
          createdAt: now,
          updatedAt: now,
          createdById: actor.userId,
          updatedById: actor.userId,
          archivedAt: null,
          archivedById: null,
        };
        await this.support.invoices.insert(record);
        await this.support.project(null, record);
        await this.support.record(actorOf(actor), 'CREATE', null, record);
        return record.id;
      },
      { isolation: 'Serializable' },
    );
    return this.support.output(id);
  }
}
