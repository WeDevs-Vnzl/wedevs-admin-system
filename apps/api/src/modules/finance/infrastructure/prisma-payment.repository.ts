import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ValidationFailedError } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { roundMoney, subMoney } from '../../../shared/domain/money';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import type {
  CreditRowView,
  DuplicateMatchView,
  DuplicateQuery,
  PaymentAllocationRecord,
  PaymentAllocationView,
  PaymentFilter,
  PaymentLabel,
  PaymentListRowView,
  PaymentRecord,
  PaymentRepository,
  PaymentView,
} from '../application/ports/payment.repository.port';
import {
  anyOf,
  dateBound,
  hasSearchText,
  orderBy,
  searchPage,
} from '../../../shared/infrastructure/prisma/search-entry-page';

/** Key of a receipt file that is already another payment's (`receiptFileId` is unique). */
const RECEIPT_UNAVAILABLE = 'payments.validation.receiptUnavailable';
const DUPLICATE_ALLOCATION = 'payments.validation.duplicateInvoiceAllocation';

const VIEW_INCLUDE = {
  client: { select: { id: true, code: true, tradeName: true } },
  method: { select: { id: true, code: true, name: true, nameEn: true } },
  account: { select: { id: true, name: true } },
  receiptFile: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      uploadedById: true,
      createdAt: true,
    },
  },
  allocations: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { invoice: { select: { id: true, code: true, invoiceNumber: true, currency: true } } },
  },
} satisfies Prisma.PaymentInclude;

const ROW_INCLUDE = {
  client: VIEW_INCLUDE.client,
  method: VIEW_INCLUDE.method,
  account: VIEW_INCLUDE.account,
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<object>;
type ViewRow = Prisma.PaymentGetPayload<{ include: typeof VIEW_INCLUDE }>;
type ListRow = Prisma.PaymentGetPayload<{ include: typeof ROW_INCLUDE }>;
type AllocationRow = Prisma.PaymentAllocationGetPayload<object>;

/** A `Decimal(18,2)` column as a two-decimal string (`toFixed()` alone would drop trailing zeros). */
const money = (value: Prisma.Decimal): string => roundMoney(decimalToString(value));
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    code: row.code,
    clientId: row.clientId,
    date: dbDateToDateOnly(row.date),
    accountId: row.accountId,
    methodId: row.methodId,
    currency: row.currency,
    amount: money(row.amount),
    igtfAmount: money(row.igtfAmount),
    feeAmount: money(row.feeAmount),
    netCredited: money(row.netCredited),
    allocatable: money(row.allocatable),
    unallocated: money(row.unallocated),
    usdRate: decimalToString(row.usdRate),
    amountUsd: money(row.amountUsd),
    reference: row.reference,
    status: row.status,
    receiptFileId: row.receiptFileId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    updatedById: row.updatedById,
  };
}

function toAllocationRecord(row: AllocationRow): PaymentAllocationRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    invoiceId: row.invoiceId,
    amountPaymentCurrency: money(row.amountPaymentCurrency),
    amountInvoiceCurrency: money(row.amountInvoiceCurrency),
    amountUsd: money(row.amountUsd),
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
    deletedAt: iso(row.deletedAt),
  };
}

const clientRef = (client: { id: string; code: string; tradeName: string }): EntityRef => ({
  type: 'CLIENT',
  id: client.id,
  code: client.code,
  label: client.tradeName,
});
const accountRef = (account: { id: string; name: string }): EntityRef => ({
  type: 'ACCOUNT',
  id: account.id,
  label: account.name,
});

function toAllocationView(row: ViewRow['allocations'][number]): PaymentAllocationView {
  return {
    id: row.id,
    paymentId: row.paymentId,
    invoice: {
      type: 'INVOICE',
      id: row.invoice.id,
      code: row.invoice.code,
      label: row.invoice.invoiceNumber,
    },
    invoiceCurrency: row.invoice.currency,
    amountPaymentCurrency: money(row.amountPaymentCurrency),
    amountInvoiceCurrency: money(row.amountInvoiceCurrency),
    amountUsd: money(row.amountUsd),
    createdAt: row.createdAt.toISOString(),
  };
}

function toView(row: ViewRow): PaymentView {
  const record = toRecord(row);
  return {
    ...record,
    client: clientRef(row.client),
    method: row.method,
    account: accountRef(row.account),
    allocated: subMoney(record.allocatable, record.unallocated),
    allocations: row.allocations.map(toAllocationView),
    receipt: row.receiptFile
      ? { ...row.receiptFile, createdAt: row.receiptFile.createdAt.toISOString() }
      : null,
  };
}

function toListRow(row: ListRow): PaymentListRowView {
  const record = toRecord(row);
  return {
    id: record.id,
    code: record.code,
    date: record.date,
    client: clientRef(row.client),
    method: row.method,
    account: accountRef(row.account),
    currency: record.currency,
    amount: record.amount,
    amountUsd: record.amountUsd,
    allocated: subMoney(record.allocatable, record.unallocated),
    unallocated: record.unallocated,
    reference: record.reference,
    status: record.status,
  };
}

function data(record: PaymentRecord) {
  return {
    code: record.code,
    clientId: record.clientId,
    date: dateOnlyToDbDate(record.date),
    accountId: record.accountId,
    methodId: record.methodId,
    currency: record.currency,
    amount: stringToDecimal(record.amount),
    igtfAmount: stringToDecimal(record.igtfAmount),
    feeAmount: stringToDecimal(record.feeAmount),
    netCredited: stringToDecimal(record.netCredited),
    allocatable: stringToDecimal(record.allocatable),
    unallocated: stringToDecimal(record.unallocated),
    usdRate: stringToDecimal(record.usdRate),
    amountUsd: stringToDecimal(record.amountUsd),
    reference: record.reference,
    status: record.status,
    receiptFileId: record.receiptFileId,
    createdById: record.createdById,
    updatedById: record.updatedById,
  };
}

/**
 * `Payment` and `PaymentAllocation` rows through the current transaction. The list and detail labels join
 * `Client` (commercial), `Account`, `PaymentMethod` (settings), the receipt's `File` metadata (platform, seven
 * columns, never `storageKey` or `bucket`) and the tag assignments as read-only selects (DT-118). Payments are never archived (Q-BE3-4), so
 * no read filters `deletedAt`. Allocations are soft-deleted (contract choice 3): the live ones have `deletedAt`
 * null, and `allocation_unique_active` allows one live row per payment and invoice.
 */
@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findById(id: string): Promise<PaymentRecord | null> {
    const row = await this.host.db.payment.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async insert(record: PaymentRecord): Promise<void> {
    try {
      await this.host.db.payment.create({
        data: { id: record.id, ...data(record), createdAt: new Date(record.createdAt) },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(record: PaymentRecord): Promise<void> {
    try {
      await this.host.db.payment.update({ where: { id: record.id }, data: data(record) });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    if (isUniqueViolation(error, 'receiptFileId')) {
      return new ValidationFailedError({
        fieldErrors: { receiptFileId: [RECEIPT_UNAVAILABLE] },
      });
    }
    return error;
  }

  async liveAllocations(paymentId: string): Promise<PaymentAllocationRecord[]> {
    const rows = await this.host.db.paymentAllocation.findMany({
      where: { paymentId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAllocationRecord);
  }

  async findAllocation(id: string): Promise<PaymentAllocationRecord | null> {
    const row = await this.host.db.paymentAllocation.findUnique({ where: { id } });
    return row ? toAllocationRecord(row) : null;
  }

  async insertAllocation(record: PaymentAllocationRecord): Promise<void> {
    try {
      await this.host.db.paymentAllocation.create({
        data: {
          id: record.id,
          paymentId: record.paymentId,
          invoiceId: record.invoiceId,
          amountPaymentCurrency: stringToDecimal(record.amountPaymentCurrency),
          amountInvoiceCurrency: stringToDecimal(record.amountInvoiceCurrency),
          amountUsd: stringToDecimal(record.amountUsd),
          createdAt: new Date(record.createdAt),
          createdById: record.createdById,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, 'allocation_unique_active')) {
        throw new ConflictError({
          fieldErrors: { 'allocations.0.invoiceId': [DUPLICATE_ALLOCATION] },
        });
      }
      throw error;
    }
  }

  async updateAllocationUsd(id: string, amountUsd: string): Promise<void> {
    await this.host.db.paymentAllocation.updateMany({
      where: { id, deletedAt: null },
      data: { amountUsd: stringToDecimal(amountUsd) },
    });
  }

  async softDeleteAllocations(ids: readonly string[], deletedAt: string): Promise<void> {
    if (ids.length === 0) return;
    await this.host.db.paymentAllocation.updateMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      data: { deletedAt: new Date(deletedAt) },
    });
  }

  async view(id: string): Promise<PaymentView | null> {
    const row = await this.host.db.payment.findUnique({ where: { id }, include: VIEW_INCLUDE });
    return row ? toView(row) : null;
  }

  private where(filter: PaymentFilter): Prisma.PaymentWhereInput {
    const and: Prisma.PaymentWhereInput[] = [];
    if (filter.status) and.push({ status: { in: [...filter.status] } });
    if (filter.clientId) and.push({ clientId: { in: [...filter.clientId] } });
    if (filter.accountId) and.push({ accountId: { in: [...filter.accountId] } });
    if (filter.methodId) and.push({ methodId: { in: [...filter.methodId] } });
    if (filter.currency) and.push({ currency: { in: [...filter.currency] } });
    if (filter.tagId) and.push({ tags: { some: { tagId: { in: [...filter.tagId] } } } });
    if (filter.dateFrom) and.push({ date: { gte: dateOnlyToDbDate(filter.dateFrom) } });
    if (filter.dateTo) and.push({ date: { lte: dateOnlyToDbDate(filter.dateTo) } });
    if (filter.hasUnallocated) and.push({ unallocated: { gt: 0 } });
    return and.length > 0 ? { AND: and } : {};
  }

  /** The filters of `where` as SQL conditions, for the search path (the page is selected by Postgres). */
  private conditions(filter: PaymentFilter): Prisma.Sql[] {
    const sql: Prisma.Sql[] = [Prisma.sql`"deletedAt" IS NULL`];
    if (filter.status) sql.push(anyOf('status', filter.status));
    if (filter.clientId) sql.push(anyOf('clientId', filter.clientId));
    if (filter.accountId) sql.push(anyOf('accountId', filter.accountId));
    if (filter.methodId) sql.push(anyOf('methodId', filter.methodId));
    if (filter.currency) sql.push(anyOf('currency', filter.currency));
    if (filter.tagId) {
      sql.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "TagAssignment" t WHERE t."paymentId" = "Payment"."id" AND t."tagId" = ANY(${[...filter.tagId]}::text[]))`,
      );
    }
    if (filter.dateFrom) sql.push(dateBound('date', '>=', dateOnlyToDbDate(filter.dateFrom)));
    if (filter.dateTo) sql.push(dateBound('date', '<=', dateOnlyToDbDate(filter.dateTo)));
    if (filter.hasUnallocated) sql.push(Prisma.sql`"unallocated" > 0`);
    return sql;
  }

  /** A list with a `q`: Postgres resolves it through `SearchEntry` and pages and counts the match. */
  private async searchList(
    filter: PaymentFilter & { q: string },
  ): Promise<Paginated<PaymentListRowView>> {
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const { sort } = filter;
    const order =
      sort.field === 'allocated'
        ? Prisma.sql`("allocatable" - "unallocated") ${Prisma.raw(sort.direction === 'asc' ? 'ASC' : 'DESC')}, "id" ASC`
        : orderBy(sort.field, sort.direction);
    const { ids, total } = await searchPage(this.host.db, 'PAYMENT', filter.q, {
      table: 'Payment',
      conditions: this.conditions(filter),
      order,
      skip,
      take,
    });
    const rows = await this.host.db.payment.findMany({
      where: { id: { in: ids } },
      include: ROW_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const page = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toListRow(row)] : [];
    });
    return paginated(page, total, filter);
  }

  async list(filter: PaymentFilter): Promise<Paginated<PaymentListRowView>> {
    if (hasSearchText(filter.q)) return this.searchList({ ...filter, q: filter.q });
    const where = this.where(filter);
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const total = await this.host.db.payment.count({ where });
    if (filter.sort.field === 'allocated') {
      // `allocated` is `allocatable − unallocated`, which no column holds: order the matching ids in memory.
      const all = await this.host.db.payment.findMany({
        where,
        select: { id: true, allocatable: true, unallocated: true },
      });
      const sign = filter.sort.direction === 'asc' ? 1 : -1;
      const ordered = all
        .map((row) => ({ id: row.id, allocated: row.allocatable.minus(row.unallocated) }))
        .sort((a, b) => sign * a.allocated.comparedTo(b.allocated) || a.id.localeCompare(b.id))
        .slice(skip, skip + take)
        .map((row) => row.id);
      const rows = await this.host.db.payment.findMany({
        where: { id: { in: ordered } },
        include: ROW_INCLUDE,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const page = ordered.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toListRow(row)] : [];
      });
      return paginated(page, total, filter);
    }
    const rows = await this.host.db.payment.findMany({
      where,
      include: ROW_INCLUDE,
      orderBy: [{ [filter.sort.field]: filter.sort.direction }, { id: 'asc' }],
      skip,
      take,
    });
    return paginated(rows.map(toListRow), total, filter);
  }

  async duplicates(query: DuplicateQuery): Promise<DuplicateMatchView[]> {
    const rows = await this.host.db.payment.findMany({
      where: {
        methodId: query.methodId,
        accountId: query.accountId,
        status: { not: 'ANULADO' },
        reference: { equals: query.reference, mode: 'insensitive' },
        ...(query.excludePaymentId ? { id: { not: query.excludePaymentId } } : {}),
      },
      select: { id: true, code: true, date: true, amount: true, currency: true, status: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      payment: { type: 'PAYMENT' as const, id: row.id, code: row.code, label: row.code },
      date: dbDateToDateOnly(row.date),
      amount: money(row.amount),
      currency: row.currency,
      status: row.status,
    }));
  }

  async creditRows(clientId: string): Promise<CreditRowView[]> {
    const rows = await this.host.db.payment.findMany({
      where: { clientId, status: 'CONFIRMADO', unallocated: { gt: 0 } },
      select: {
        id: true,
        code: true,
        date: true,
        currency: true,
        unallocated: true,
        usdRate: true,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      paymentId: row.id,
      code: row.code,
      date: dbDateToDateOnly(row.date),
      currency: row.currency,
      unallocated: money(row.unallocated),
      usdRate: decimalToString(row.usdRate),
    }));
  }

  async labels(ids: readonly string[]): Promise<Map<string, PaymentLabel>> {
    const rows = await this.host.db.payment.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, clientId: true },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  async hasReceiptFile(fileId: string): Promise<boolean> {
    const count = await this.host.db.payment.count({ where: { receiptFileId: fileId } });
    return count > 0;
  }
}
