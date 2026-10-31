import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { PAYMENT_STATUS_VALUES, type PaymentStatus } from '../../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import { sumMoney, toUsd, type MoneyString } from '../../../../../shared/domain/money';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type { InvoiceRepository, OpenInvoiceView } from '../../ports/invoice.repository.port';
import type { PaymentReferencesPort } from '../../ports/payment-references.port';
import type {
  DuplicateMatchView,
  PaymentFilter,
  PaymentListRowView,
  PaymentRepository,
} from '../../ports/payment.repository.port';
import { addError, dateError, textError, throwIfAny } from '../expenses/expense-support';
import { PAYMENT_MESSAGES, PAYMENT_SORT_FIELDS } from './payment-input';
import { isOpenInvoice, type PaymentOutput } from './payment-support';

export const DEFAULT_PAYMENT_SORT: SortSpec = { field: 'date', direction: 'desc' };

function many(query: ListQuery, name: string): string[] | undefined {
  const value = query.filters[name];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : [...value];
}

/** Maps the list query of the route to the repository filter, repeating the checks the DTO makes. */
export function toPaymentFilter(query: ListQuery): PaymentFilter {
  const errors: FieldErrors = {};
  const statuses = many(query, 'status');
  const dateFrom = many(query, 'dateFrom')?.[0];
  const dateTo = many(query, 'dateTo')?.[0];
  const unallocated = many(query, 'hasUnallocated')?.[0];
  if (dateFrom !== undefined) dateError(errors, 'dateFrom', dateFrom);
  if (dateTo !== undefined) dateError(errors, 'dateTo', dateTo);
  if (statuses?.some((value) => !(PAYMENT_STATUS_VALUES as readonly string[]).includes(value))) {
    addError(errors, 'status', PAYMENT_MESSAGES.invalidOption);
  }
  if (unallocated !== undefined && unallocated !== 'true' && unallocated !== 'false') {
    addError(errors, 'hasUnallocated', PAYMENT_MESSAGES.invalidOption);
  }
  if (query.sort && !(PAYMENT_SORT_FIELDS as readonly string[]).includes(query.sort.field)) {
    addError(errors, 'sort', PAYMENT_MESSAGES.invalidSort);
  }
  throwIfAny(errors);

  const clientId = many(query, 'clientId');
  const accountId = many(query, 'accountId');
  const methodId = many(query, 'methodId');
  const currency = many(query, 'currency');
  const tagId = many(query, 'tagId');
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(statuses ? { status: statuses as PaymentStatus[] } : {}),
    ...(clientId ? { clientId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(methodId ? { methodId } : {}),
    ...(currency ? { currency } : {}),
    ...(tagId ? { tagId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(unallocated === 'true' ? { hasUnallocated: true } : {}),
    sort: query.sort ?? DEFAULT_PAYMENT_SORT,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** The payments table (PRD §8.6): `can(read, payment)` first; every filter is optional and they combine with AND. */
export class ListPayments {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<PaymentListRowView>> {
    assertCan(this.authorization, actor, 'read', 'payment');
    return this.payments.list(toPaymentFilter(query));
  }
}

/** One payment with its amounts and its live allocations (`/payments/[id]`). */
export class GetPayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<PaymentOutput> {
    assertCan(this.authorization, actor, 'read', 'payment');
    const view = await this.payments.view(id);
    if (!view) throw new NotFoundError();
    return view;
  }
}

export interface ClientCreditOutput {
  readonly totalUsd: MoneyString;
  readonly payments: readonly {
    readonly paymentId: string;
    readonly code: string;
    readonly date: DateOnly;
    readonly currency: string;
    readonly unallocated: MoneyString;
    readonly unallocatedUsd: MoneyString;
  }[];
}

/**
 * Saldo a favor of a client (HU-13 CA5): what its confirmed payments did not apply, oldest first, each at its own
 * payment rate (the same USD value `ClientMetrics.creditUsd` holds).
 */
export class GetClientCredit {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly payments: PaymentRepository,
    private readonly references: PaymentReferencesPort,
  ) {}

  async execute(actor: CurrentUser, clientId: string): Promise<ClientCreditOutput> {
    assertCan(this.authorization, actor, 'read', 'payment');
    if (!(await this.references.liveClient(clientId))) throw new NotFoundError();
    const items = (await this.payments.creditRows(clientId)).map((row) => ({
      paymentId: row.paymentId,
      code: row.code,
      date: row.date,
      currency: row.currency,
      unallocated: row.unallocated,
      unallocatedUsd: toUsd(row.unallocated, row.usdRate),
    }));
    return { totalUsd: sumMoney(items.map((item) => item.unallocatedUsd)), payments: items };
  }
}

export interface DetectDuplicatePaymentInput {
  readonly methodId: string;
  readonly accountId: string;
  readonly reference: string;
  /** The payment being edited, so it does not match itself. */
  readonly excludePaymentId?: string | null | undefined;
}

export interface DuplicatePaymentWarning {
  readonly duplicate: boolean;
  readonly matches: readonly DuplicateMatchView[];
}

/**
 * Possible duplicates (HU-13 CA6, PRD §8.6): same reference, method and account, not voided. A warning only: the
 * caller shows it and the payment can still be saved.
 */
export class DetectDuplicatePayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    input: DetectDuplicatePaymentInput,
  ): Promise<DuplicatePaymentWarning> {
    assertCan(this.authorization, actor, 'read', 'payment');
    const errors: FieldErrors = {};
    for (const field of ['methodId', 'accountId'] as const) {
      if (typeof input[field] !== 'string' || input[field].trim() === '') {
        addError(errors, field, PAYMENT_MESSAGES.required);
      }
    }
    textError(errors, 'reference', input.reference, 80, true);
    throwIfAny(errors);
    const matches = await this.payments.duplicates({
      methodId: input.methodId,
      accountId: input.accountId,
      reference: input.reference.trim(),
      ...(input.excludePaymentId ? { excludePaymentId: input.excludePaymentId } : {}),
    });
    return { duplicate: matches.length > 0, matches };
  }
}

export interface InvoicePaymentContext {
  readonly client: EntityRef;
  readonly invoice: OpenInvoiceView;
}

/**
 * The invoice a new payment starts from (`/payments/new?invoiceId=`): its client and its open option. An unknown
 * invoice, or one that no longer takes a payment (voided, archived, paid, draft), is a generic `NOT_FOUND`.
 */
export class GetInvoiceForPayment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceRepository,
    private readonly references: PaymentReferencesPort,
  ) {}

  async execute(actor: CurrentUser, invoiceId: string): Promise<InvoicePaymentContext> {
    assertCan(this.authorization, actor, 'read', 'payment');
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice || !isOpenInvoice(invoice)) throw new NotFoundError();
    const client = await this.references.liveClient(invoice.clientId);
    if (!client) throw new NotFoundError();
    return {
      client,
      invoice: {
        id: invoice.id,
        code: invoice.code,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        usdRate: invoice.usdRate,
        receivable: invoice.receivable,
        balance: invoice.balance,
        status: invoice.status,
      },
    };
  }
}
