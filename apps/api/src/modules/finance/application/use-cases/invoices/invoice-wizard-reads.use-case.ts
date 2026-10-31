import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import type { InstallmentKind } from '../../../../../shared/domain/enums';
import { compareMoney, subMoney, type MoneyString } from '../../../../../shared/domain/money';
import type { InvoiceReferencesPort } from '../../ports/invoice-references.port';
import type { InvoiceRepository, OpenInvoiceView } from '../../ports/invoice.repository.port';

/** A pending installment the "Facturar cuotas" wizard offers (PRD §8.5). */
export interface BillableInstallmentOutput {
  readonly installment: EntityRef;
  readonly project: EntityRef;
  readonly kind: InstallmentKind;
  readonly label: string;
  readonly currency: string;
  readonly amount: MoneyString;
  /** Part of `amount` not yet covered by live invoice lines. */
  readonly remainingAmount: MoneyString;
  readonly dueDate: DateOnly | null;
}

/**
 * `listBillableInstallments`: the `PENDIENTE` installments of every live project of the client, with what is
 * left to bill. An unknown or archived client is `NOT_FOUND` (never trust a client id, C14).
 */
export class ListBillableInstallments {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceRepository,
    private readonly references: InvoiceReferencesPort,
  ) {}

  async execute(actor: CurrentUser, clientId: string): Promise<BillableInstallmentOutput[]> {
    assertCan(this.authorization, actor, 'read', 'invoice');
    if (!(await this.references.liveClient(clientId))) throw new NotFoundError();
    const projects = await this.references.liveProjectsOfClient(clientId);
    const rows = await this.invoices.billableInstallments(projects.map((project) => project.id));
    return rows.map((row) => ({
      installment: row.installment,
      project: row.project,
      kind: row.kind,
      label: row.label,
      currency: row.currency,
      amount: row.amount,
      remainingAmount:
        compareMoney(row.amount, row.invoicedAmount) > 0
          ? subMoney(row.amount, row.invoicedAmount)
          : '0.00',
      dueDate: row.dueDate,
    }));
  }
}

/**
 * `listOpenInvoices`: the client's issued, not fully paid, not archived invoices, as the payment form's
 * "Apply to invoices" list needs them.
 */
export class ListOpenInvoices {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceRepository,
    private readonly references: InvoiceReferencesPort,
  ) {}

  async execute(actor: CurrentUser, clientId: string): Promise<OpenInvoiceView[]> {
    assertCan(this.authorization, actor, 'read', 'invoice');
    if (!(await this.references.liveClient(clientId))) throw new NotFoundError();
    return this.invoices.openInvoices(clientId);
  }
}
