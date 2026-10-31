import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, ValidationFailedError } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { DateOnly } from '../../../shared/domain/business-date';
import { compareMoney, roundMoney, sumMoney, toUsd } from '../../../shared/domain/money';
import { pageWindow, paginated, type Paginated } from '../../../shared/domain/pagination';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { archivedWhere } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import type {
  BillableInstallmentView,
  InstallmentRef,
  InvoiceAllocationState,
  InvoiceFilter,
  InvoiceLabel,
  InvoiceLineRecord,
  InvoiceListRowView,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceView,
  OpenInvoiceView,
} from '../application/ports/invoice.repository.port';
import { INVOICE_ERRORS } from '../domain/errors';

const NUMBER_INDEX = 'invoice_number_active';
/** An invoice that still binds an installment: not voided and not archived (drafts count). */
const BINDING = { deletedAt: null, voidedAt: null, status: { not: 'ANULADA' } } as const;
const OPEN_STATUSES = ['EMITIDA', 'PARCIAL', 'VENCIDA'] as const;

const RECORD_INCLUDE = {
  lines: { orderBy: { order: 'asc' } },
  taxLines: { orderBy: { ivaRate: 'desc' } },
} satisfies Prisma.InvoiceInclude;

const VIEW_INCLUDE = {
  client: { select: { id: true, code: true, tradeName: true } },
  file: {
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
  lines: {
    orderBy: { order: 'asc' },
    include: {
      project: { select: { id: true, code: true, name: true } },
      installment: { select: { id: true, label: true } },
    },
  },
  taxLines: { orderBy: { ivaRate: 'desc' } },
  allocations: {
    where: { deletedAt: null, payment: { status: { not: 'ANULADO' }, deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    include: { payment: { select: { id: true, code: true, date: true, currency: true } } },
  },
} as const;

const ROW_INCLUDE = {
  client: { select: { id: true, code: true, tradeName: true } },
  lines: {
    orderBy: { order: 'asc' },
    select: { project: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof RECORD_INCLUDE }>;
type ViewRow = Prisma.InvoiceGetPayload<{ include: typeof VIEW_INCLUDE }>;
type ListRow = Prisma.InvoiceGetPayload<{ include: typeof ROW_INCLUDE }>;

/** A `Decimal(18,2)` column as a two-decimal string (`toFixed()` alone would drop trailing zeros). */
const money = (value: Prisma.Decimal): string => roundMoney(decimalToString(value));
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function toLines(row: InvoiceRow): InvoiceLineRecord[] {
  return row.lines.map((line) => ({
    id: line.id,
    order: line.order,
    description: line.description,
    projectId: line.projectId,
    installmentId: line.installmentId,
    quantity: money(line.quantity),
    unitPrice: money(line.unitPrice),
    amount: money(line.amount),
    discount: money(line.discount),
    netAmount: money(line.netAmount),
    ivaRate: line.ivaRate === null ? null : decimalToString(line.ivaRate),
  }));
}

function toRecord(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    code: row.code,
    clientId: row.clientId,
    invoiceNumber: row.invoiceNumber,
    controlNumber: row.controlNumber,
    issueDate: dbDateToDateOnly(row.issueDate),
    dueDate: dbDateToDateOnly(row.dueDate),
    currency: row.currency,
    usdRate: decimalToString(row.usdRate),
    bcvRate: row.bcvRate === null ? null : decimalToString(row.bcvRate),
    subtotal: money(row.subtotal),
    discount: money(row.discount),
    exemptAmount: money(row.exemptAmount),
    taxBase: money(row.taxBase),
    ivaAmount: money(row.ivaAmount),
    total: money(row.total),
    ivaWithheld: money(row.ivaWithheld),
    islrWithheld: money(row.islrWithheld),
    otherWithheld: money(row.otherWithheld),
    otherWithheldNote: row.otherWithheldNote,
    receivable: money(row.receivable),
    totalUsd: money(row.totalUsd),
    receivableUsd: money(row.receivableUsd),
    paidAmount: money(row.paidAmount),
    balance: money(row.balance),
    isDraft: row.isDraft,
    status: row.status,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    fileId: row.fileId,
    lines: toLines(row),
    taxLines: row.taxLines.map((line) => ({
      ivaRate: decimalToString(line.ivaRate),
      taxBase: money(line.taxBase),
      ivaAmount: money(line.ivaAmount),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    updatedById: row.updatedById,
    archivedAt: iso(row.deletedAt),
    archivedById: row.deletedById,
  };
}

const clientRef = (client: { id: string; code: string; tradeName: string }): EntityRef => ({
  type: 'CLIENT',
  id: client.id,
  code: client.code,
  label: client.tradeName,
});
const projectRef = (project: { id: string; code: string; name: string }): EntityRef => ({
  type: 'PROJECT',
  id: project.id,
  code: project.code,
  label: project.name,
});

function toView(row: ViewRow): InvoiceView {
  const record = toRecord(row as unknown as InvoiceRow);
  return {
    ...record,
    client: clientRef(row.client),
    lines: toLines(row as unknown as InvoiceRow).map((line, index) => {
      const source = row.lines[index];
      return {
        ...line,
        project: source?.project ? projectRef(source.project) : null,
        installment: source?.installment
          ? {
              type: 'INSTALLMENT' as const,
              id: source.installment.id,
              label: source.installment.label,
            }
          : null,
      };
    }),
    file: row.file
      ? {
          id: row.file.id,
          originalName: row.file.originalName,
          mimeType: row.file.mimeType,
          sizeBytes: row.file.sizeBytes,
          status: row.file.status,
          uploadedById: row.file.uploadedById,
          createdAt: row.file.createdAt.toISOString(),
        }
      : null,
    allocations: row.allocations.map((allocation) => ({
      id: allocation.id,
      payment: {
        type: 'PAYMENT' as const,
        id: allocation.payment.id,
        code: allocation.payment.code,
        label: allocation.payment.code,
      },
      paymentDate: dbDateToDateOnly(allocation.payment.date),
      paymentCurrency: allocation.payment.currency,
      amountPaymentCurrency: money(allocation.amountPaymentCurrency),
      amountInvoiceCurrency: money(allocation.amountInvoiceCurrency),
      amountUsd: money(allocation.amountUsd),
    })),
  };
}

function toListRow(row: ListRow): InvoiceListRowView {
  const projects = new Map<string, EntityRef>();
  for (const line of row.lines) {
    if (line.project && !projects.has(line.project.id)) {
      projects.set(line.project.id, projectRef(line.project));
    }
  }
  const balance = money(row.balance);
  return {
    id: row.id,
    code: row.code,
    invoiceNumber: row.invoiceNumber,
    client: clientRef(row.client),
    projects: [...projects.values()],
    issueDate: dbDateToDateOnly(row.issueDate),
    dueDate: dbDateToDateOnly(row.dueDate),
    currency: row.currency,
    total: money(row.total),
    balance,
    totalUsd: money(row.totalUsd),
    balanceUsd: toUsd(balance, decimalToString(row.usdRate)),
    status: row.status,
    paidAmount: money(row.paidAmount),
    archivedAt: iso(row.deletedAt),
  };
}

function data(record: InvoiceRecord) {
  const lines = record.lines.map((line) => ({
    id: line.id,
    order: line.order,
    description: line.description,
    projectId: line.projectId,
    installmentId: line.installmentId,
    quantity: stringToDecimal(line.quantity),
    unitPrice: stringToDecimal(line.unitPrice),
    amount: stringToDecimal(line.amount),
    discount: stringToDecimal(line.discount),
    netAmount: stringToDecimal(line.netAmount),
    ivaRate: line.ivaRate === null ? null : stringToDecimal(line.ivaRate),
  }));
  const taxLines = record.taxLines.map((line) => ({
    ivaRate: stringToDecimal(line.ivaRate),
    taxBase: stringToDecimal(line.taxBase),
    ivaAmount: stringToDecimal(line.ivaAmount),
  }));
  return {
    header: {
      code: record.code,
      clientId: record.clientId,
      invoiceNumber: record.invoiceNumber,
      controlNumber: record.controlNumber,
      issueDate: dateOnlyToDbDate(record.issueDate),
      dueDate: dateOnlyToDbDate(record.dueDate),
      currency: record.currency,
      usdRate: stringToDecimal(record.usdRate),
      bcvRate: record.bcvRate === null ? null : stringToDecimal(record.bcvRate),
      subtotal: stringToDecimal(record.subtotal),
      discount: stringToDecimal(record.discount),
      exemptAmount: stringToDecimal(record.exemptAmount),
      taxBase: stringToDecimal(record.taxBase),
      ivaAmount: stringToDecimal(record.ivaAmount),
      total: stringToDecimal(record.total),
      ivaWithheld: stringToDecimal(record.ivaWithheld),
      islrWithheld: stringToDecimal(record.islrWithheld),
      otherWithheld: stringToDecimal(record.otherWithheld),
      otherWithheldNote: record.otherWithheldNote,
      receivable: stringToDecimal(record.receivable),
      totalUsd: stringToDecimal(record.totalUsd),
      receivableUsd: stringToDecimal(record.receivableUsd),
      paidAmount: stringToDecimal(record.paidAmount),
      balance: stringToDecimal(record.balance),
      isDraft: record.isDraft,
      status: record.status,
      voidedAt: record.voidedAt === null ? null : new Date(record.voidedAt),
      voidReason: record.voidReason,
      fileId: record.fileId,
      updatedAt: new Date(record.updatedAt),
      updatedById: record.updatedById,
      deletedAt: record.archivedAt === null ? null : new Date(record.archivedAt),
      deletedById: record.archivedById,
    },
    lines,
    taxLines,
  };
}

const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

/** Direct (column) sorts of the table; `balanceUsd` is computed and `daysOverdue` follows the due date. */
const COLUMN_SORTS: Readonly<Record<string, string>> = {
  code: 'code',
  invoiceNumber: 'invoiceNumber',
  issueDate: 'issueDate',
  dueDate: 'dueDate',
  total: 'total',
  totalUsd: 'totalUsd',
  balance: 'balance',
  status: 'status',
};

/**
 * `Invoice`, `InvoiceLine` and `InvoiceTaxLine` through the current transaction, plus the finance rows an invoice
 * reads (installments, allocations, payments). List labels join `Client`, `Project` and the tag assignments as
 * read-only selects (DT-118). By-id reads return archived invoices flagged; lists filter them with
 * `archivedWhere`. The partial unique on the number and the unique on the file are translated to domain errors.
 */
@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async findById(id: string): Promise<InvoiceRecord | null> {
    const row = await this.host.db.invoice.findUnique({ where: { id }, include: RECORD_INCLUDE });
    return row ? toRecord(row) : null;
  }

  async insert(record: InvoiceRecord): Promise<void> {
    const { header, lines, taxLines } = data(record);
    try {
      await this.host.db.invoice.create({
        data: {
          id: record.id,
          ...header,
          createdAt: new Date(record.createdAt),
          createdById: record.createdById,
          lines: { create: lines },
          taxLines: { create: taxLines },
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(record: InvoiceRecord): Promise<void> {
    const { header, lines, taxLines } = data(record);
    try {
      await this.host.db.invoice.update({
        where: { id: record.id },
        data: {
          ...header,
          lines: { deleteMany: {}, create: lines },
          taxLines: { deleteMany: {}, create: taxLines },
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    if (isUniqueViolation(error, NUMBER_INDEX)) {
      return new ConflictError({
        message: INVOICE_ERRORS.numberTaken,
        fieldErrors: { invoiceNumber: [INVOICE_ERRORS.numberTaken] },
      });
    }
    if (isUniqueViolation(error, 'fileId')) {
      return new ValidationFailedError({
        fieldErrors: { fileId: [INVOICE_ERRORS.fileNotReady] },
      });
    }
    return error;
  }

  async numberHolder(invoiceNumber: string, exceptId: string | null): Promise<InvoiceLabel | null> {
    const wanted = invoiceNumber.trim().toLowerCase();
    const rows = await this.host.db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invoice"
      WHERE "deletedAt" IS NULL
        AND lower(btrim("invoiceNumber")) = ${wanted}
        AND (${exceptId}::text IS NULL OR "id" <> ${exceptId})
      LIMIT 1`;
    const id = rows[0]?.id;
    if (id === undefined) return null;
    return (await this.labels([id])).get(id) ?? null;
  }

  async liveAllocations(invoiceId: string): Promise<InvoiceAllocationState[]> {
    const rows = await this.host.db.paymentAllocation.findMany({
      where: {
        invoiceId,
        deletedAt: null,
        payment: { status: { not: 'ANULADO' }, deletedAt: null },
      },
      select: {
        amountInvoiceCurrency: true,
        payment: { select: { id: true, status: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      paymentId: row.payment.id,
      amountInvoiceCurrency: money(row.amountInvoiceCurrency),
      paymentStatus: row.payment.status,
    }));
  }

  async installments(ids: readonly string[]): Promise<InstallmentRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.host.db.billingInstallment.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      label: row.label,
      currency: row.currency,
      amount: money(row.amount),
      cancelled: row.cancelledAt !== null,
    }));
  }

  async billedAmounts(
    installmentIds: readonly string[],
    exceptInvoiceId: string | null,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (installmentIds.length === 0) return result;
    const lines = await this.host.db.invoiceLine.findMany({
      where: {
        installmentId: { in: [...installmentIds] },
        invoice: { ...BINDING, ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) },
      },
      select: { installmentId: true, netAmount: true },
    });
    const byInstallment = new Map<string, string[]>();
    for (const line of lines) {
      if (line.installmentId === null) continue;
      byInstallment.set(line.installmentId, [
        ...(byInstallment.get(line.installmentId) ?? []),
        money(line.netAmount),
      ]);
    }
    for (const [id, amounts] of byInstallment) result.set(id, sumMoney(amounts));
    return result;
  }

  async view(id: string): Promise<InvoiceView | null> {
    const row = await this.host.db.invoice.findUnique({ where: { id }, include: VIEW_INCLUDE });
    return row ? toView(row) : null;
  }

  private where(filter: InvoiceFilter): Prisma.InvoiceWhereInput {
    const and: Prisma.InvoiceWhereInput[] = [];
    if (filter.status) and.push({ status: { in: [...filter.status] } });
    if (filter.clientId) and.push({ clientId: { in: [...filter.clientId] } });
    if (filter.currency) and.push({ currency: { in: [...filter.currency] } });
    if (filter.projectId) {
      and.push({ lines: { some: { projectId: { in: [...filter.projectId] } } } });
    }
    if (filter.tagId) and.push({ tags: { some: { tagId: { in: [...filter.tagId] } } } });
    if (filter.dateFrom) and.push({ issueDate: { gte: dateOnlyToDbDate(filter.dateFrom) } });
    if (filter.dateTo) and.push({ issueDate: { lte: dateOnlyToDbDate(filter.dateTo) } });
    if (filter.q) {
      and.push({
        OR: [
          { code: contains(filter.q) },
          { invoiceNumber: contains(filter.q) },
          { client: { tradeName: contains(filter.q) } },
        ],
      });
    }
    return { ...archivedWhere(filter.archived), ...(and.length > 0 ? { AND: and } : {}) };
  }

  async list(filter: InvoiceFilter): Promise<Paginated<InvoiceListRowView>> {
    const where = this.where(filter);
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    const direction = filter.sort.direction;

    if (filter.sort.field === 'balanceUsd') {
      // The USD balance is `balance / usdRate`: no column to order by, so the matching rows are ordered here.
      const all = await this.host.db.invoice.findMany({
        where,
        select: { id: true, balance: true, usdRate: true },
      });
      const keyed = all
        .map((row) => ({
          id: row.id,
          usd: toUsd(money(row.balance), decimalToString(row.usdRate)),
        }))
        .sort(
          (a, b) =>
            compareMoney(a.usd, b.usd) * (direction === 'asc' ? 1 : -1) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      const ids = keyed.slice(skip, skip + take).map((row) => row.id);
      const rows = await this.host.db.invoice.findMany({
        where: { id: { in: ids }, ...archivedWhere('include') },
        include: ROW_INCLUDE,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const page = ids.flatMap((id) => (byId.has(id) ? [toListRow(byId.get(id) as ListRow)] : []));
      return paginated(page, keyed.length, filter);
    }

    // Days overdue grow as the due date goes back, so the order of the days is the reverse of the due date.
    const orderBy: Prisma.InvoiceOrderByWithRelationInput =
      filter.sort.field === 'daysOverdue'
        ? { dueDate: direction === 'asc' ? 'desc' : 'asc' }
        : { [COLUMN_SORTS[filter.sort.field] ?? 'issueDate']: direction };
    const rows = await this.host.db.invoice.findMany({
      where,
      include: ROW_INCLUDE,
      orderBy: [orderBy, { id: 'asc' }],
      skip,
      take,
    });
    const total = await this.host.db.invoice.count({ where });
    return paginated(rows.map(toListRow), total, filter);
  }

  async billableInstallments(projectIds: readonly string[]): Promise<BillableInstallmentView[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.host.db.billingInstallment.findMany({
      where: { projectId: { in: [...projectIds] }, status: 'PENDIENTE', cancelledAt: null },
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    const billed = await this.billedAmounts(
      rows.map((row) => row.id),
      null,
    );
    return rows.map((row) => ({
      installment: { type: 'INSTALLMENT', id: row.id, label: row.label },
      project: projectRef(row.project),
      kind: row.kind,
      label: row.label,
      currency: row.currency,
      amount: money(row.amount),
      invoicedAmount: billed.get(row.id) ?? '0.00',
      dueDate: row.dueDate === null ? null : dbDateToDateOnly(row.dueDate),
    }));
  }

  async openInvoices(clientId: string): Promise<OpenInvoiceView[]> {
    const rows = await this.host.db.invoice.findMany({
      where: { clientId, status: { in: [...OPEN_STATUSES] } },
      orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      invoiceNumber: row.invoiceNumber,
      issueDate: dbDateToDateOnly(row.issueDate),
      dueDate: dbDateToDateOnly(row.dueDate),
      currency: row.currency,
      usdRate: decimalToString(row.usdRate),
      receivable: money(row.receivable),
      balance: money(row.balance),
      status: row.status,
    }));
  }

  async overdueIds(today: DateOnly): Promise<string[]> {
    const rows = await this.host.db.invoice.findMany({
      where: {
        deletedAt: undefined,
        isDraft: false,
        status: { in: ['EMITIDA', 'PARCIAL'] },
        dueDate: { lt: dateOnlyToDbDate(today) },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async labels(ids: readonly string[]): Promise<Map<string, InvoiceLabel>> {
    if (ids.length === 0) return new Map();
    const rows = await this.host.db.invoice.findMany({
      where: { id: { in: [...ids] }, ...archivedWhere('include') },
      select: { id: true, code: true, invoiceNumber: true, clientId: true, deletedAt: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          code: row.code,
          invoiceNumber: row.invoiceNumber,
          clientId: row.clientId,
          archived: row.deletedAt !== null,
        },
      ]),
    );
  }

  async hasFile(fileId: string): Promise<boolean> {
    const count = await this.host.db.invoice.count({
      where: { fileId, ...archivedWhere('include') },
    });
    return count > 0;
  }
}
