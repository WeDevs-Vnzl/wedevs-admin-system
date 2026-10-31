import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { isValidDateOnly } from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import { INVOICE_STATUS_VALUES, type InvoiceStatus } from '../../../../../shared/domain/enums';
import type { ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type { InvoiceFilter, InvoiceRepository } from '../../ports/invoice.repository.port';
import { INVOICE_MESSAGES } from './invoice-input';
import {
  INVOICE_SORT_FIELDS,
  toInvoiceOutput,
  toInvoiceRowOutput,
  todayOf,
  type InvoiceListRowOutput,
  type InvoiceOutput,
} from './invoice-support';

export const DEFAULT_INVOICE_SORT: SortSpec = { field: 'issueDate', direction: 'desc' };

function many(query: ListQuery, name: string): string[] | undefined {
  const value = query.filters[name];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : [...value];
}

function addError(errors: FieldErrors, path: string, key: string): void {
  errors[path] = [...(errors[path] ?? []), key];
}

/** Maps the list query of the route to the repository filter, repeating the checks the DTO makes. */
export function toInvoiceFilter(
  query: ListQuery,
  archived: InvoiceFilter['archived'],
): InvoiceFilter {
  const errors: FieldErrors = {};
  const statuses = many(query, 'status');
  const dateFrom = many(query, 'dateFrom')?.[0];
  const dateTo = many(query, 'dateTo')?.[0];
  for (const [name, value] of [
    ['dateFrom', dateFrom],
    ['dateTo', dateTo],
  ] as const) {
    if (value !== undefined && !isValidDateOnly(value)) {
      addError(errors, name, INVOICE_MESSAGES.invalidDate);
    }
  }
  if (statuses?.some((value) => !(INVOICE_STATUS_VALUES as readonly string[]).includes(value))) {
    addError(errors, 'status', INVOICE_MESSAGES.invalidOption);
  }
  if (query.sort && !(INVOICE_SORT_FIELDS as readonly string[]).includes(query.sort.field)) {
    addError(errors, 'sort', INVOICE_MESSAGES.invalidSort);
  }
  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

  const clientId = many(query, 'clientId');
  const projectId = many(query, 'projectId');
  const currency = many(query, 'currency');
  const tagId = many(query, 'tagId');
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(statuses ? { status: statuses as InvoiceStatus[] } : {}),
    ...(clientId ? { clientId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(currency ? { currency } : {}),
    ...(tagId ? { tagId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    archived,
    sort: query.sort ?? DEFAULT_INVOICE_SORT,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * The invoice table (DT-25). `can(read, invoice)` first (Owner and Admin, PRD §4.3); `archived=only|include`
 * is honoured only for the trash roles, every other caller sees the live invoices. Voided invoices stay
 * visible. Every filter is optional and they combine with AND.
 */
export class ListInvoices {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<InvoiceListRowOutput>> {
    assertCan(this.authorization, actor, 'read', 'invoice');
    const archived =
      query.archived !== 'exclude' && !this.authorization.can(actor, 'restore', 'trash')
        ? 'exclude'
        : query.archived;
    const page = await this.invoices.list(toInvoiceFilter(query, archived));
    const today = todayOf(this.clock);
    return { ...page, items: page.items.map((row) => toInvoiceRowOutput(row, today)) };
  }
}

/** One invoice with its lines, tax lines, totals, allocations and file (`/invoices/[id]`). */
export class GetInvoice {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly invoices: InvoiceRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<InvoiceOutput> {
    assertCan(this.authorization, actor, 'read', 'invoice');
    const view = await this.invoices.view(id);
    if (!view) throw new NotFoundError();
    return toInvoiceOutput(view, todayOf(this.clock));
  }
}
