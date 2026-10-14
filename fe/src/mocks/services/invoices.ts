// MOCK — invoices services of Hito 1 (PRD §8.5, HU-11, HU-12). `fn(ctx, input)`, framework-free (C11). Replaced by
// `src/server/services/invoices.service.ts` in Hito 2 (C9). Every formula comes from `src/lib/finance` (C17): the
// line amounts, the per-rate tax lines, the totals, the receivable and the status are derived by the store's pass
// (`derive-finance.ts`); this file only stores the inputs and checks the business rules around them.
import { todayInCaracas, type DateOnly } from "@/lib/dates";
import { computeInvoiceTotals, computeLineAmounts } from "@/lib/finance";
import { compareMoney, roundMoney, subMoney, sumMoney, type MoneyString } from "@/lib/money";
import { DEFAULT_PAGE_SIZE, type EntityRef, type Paginated } from "@/lib/validators/common";
import type { InstallmentDTO } from "@/lib/validators/billing";
import { isAllowedIvaRate } from "@/lib/validators/settings";
import {
  INVOICE_MESSAGES,
  type BillableInstallmentRow,
  type CreateInvoiceInput,
  type InvoiceDetailDTO,
  type InvoiceFilters,
  type InvoiceLineInput,
  type InvoiceListRow,
  type InvoicesOverviewDTO,
  type IvaAdjustmentInput,
  type UpdateInvoiceInput,
  type VoidInvoiceInput,
} from "@/lib/validators/invoices";
import type { ClientRow } from "../fixtures/clients";
import type { InvoiceRow } from "../fixtures/invoices";
import type { ProjectRow } from "../fixtures/projects";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockCode, nextMockId } from "../ids";
import { deriveMockStore, type MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

/** Message keys of the domain errors (`invoices.errors.*`), shown by the form or the toast. */
export const INVOICE_ERRORS = {
  numberTaken: "invoices.errors.numberTaken",
  voided: "invoices.errors.voided",
  alreadyVoided: "invoices.errors.alreadyVoided",
  archived: "invoices.errors.archived",
  alreadyArchived: "invoices.errors.alreadyArchived",
  notDraft: "invoices.errors.notDraft",
  hasAllocations: "invoices.errors.hasAllocations",
  receivableBelowPaid: "invoices.errors.receivableBelowPaid",
  clientLocked: "invoices.errors.clientLocked",
  projectOtherClient: "invoices.errors.projectOtherClient",
  installmentCancelled: "invoices.errors.installmentCancelled",
  installmentExceeded: "invoices.errors.installmentExceeded",
  installmentCurrency: "invoices.errors.installmentCurrency",
  invalidTotals: "invoices.validation.invalidTotals",
  fileType: "invoices.validation.fileType",
  fileTooLarge: "invoices.validation.fileTooLarge",
  fileNotReady: "invoices.validation.fileNotReady",
} as const;

/** MIME types and size of an invoice file (HU-14 CA1: PDF, PNG, JPG or WEBP up to 10 MB). */
export const INVOICE_FILE_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type InvoiceListInput = Partial<InvoiceFilters> & { includeArchived?: boolean };

/** The line grid of an invoice as stored, with its derived fields still to be filled by the derive pass. */
type StoredLine = InvoiceRow["lines"][number];

// ───────────────────────────── Lookups and helpers ─────────────────────────────

function rowsOf(db: MockStore): InvoiceRow[] {
  // Rows are only written here, so the archive stamp is always present.
  return db.invoices as InvoiceRow[];
}

function invalid(field: string, key: string): ServiceError {
  return new ServiceError("VALIDATION", { fieldErrors: { [field]: [key] } });
}

function invalidAt(path: string, key: string): ServiceError {
  return new ServiceError("VALIDATION", { fieldErrors: { [path]: [key] } });
}

function findInvoice(db: MockStore, id: string): InvoiceRow {
  const row = rowsOf(db).find((item) => item.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

/** Client of an invoice call: unknown and archived clients are `NOT_FOUND` (never trust a client id). */
function liveClient(db: MockStore, clientId: string): ClientRow {
  const row = db.clients.find((item) => item.id === clientId);
  if (!row || row.archivedAt) throw new ServiceError("NOT_FOUND");
  return row;
}

function belongsTo(project: ProjectRow, clientId: string): boolean {
  return project.clients.some((link) => link.clientId === clientId);
}

/** Allocations of the invoice whose payment is not annulled: they block void and archive (HU-12 CA5). */
function activeAllocations(db: MockStore, invoiceId: string) {
  return db.paymentAllocations.filter((allocation) => {
    if (allocation.invoice.id !== invoiceId) return false;
    const payment = db.payments.find((item) => item.id === allocation.paymentId);
    return payment !== undefined && payment.status !== "ANULADO";
  });
}

/** Invoices that count for billing: not voided and not archived (drafts count, as the derive pass does). */
function billingInvoices(db: MockStore, exceptId: string | null): InvoiceRow[] {
  return rowsOf(db).filter(
    (row) => row.id !== exceptId && row.voidedAt === null && row.archivedAt === null,
  );
}

/** Invoice number is unique among non-archived invoices, case and surrounding blanks ignored (HU-11 CA3). */
function assertNumberFree(db: MockStore, invoiceNumber: string, selfId: string | null): void {
  const wanted = invoiceNumber.trim().toLowerCase();
  const taken = rowsOf(db).some(
    (row) =>
      row.archivedAt === null &&
      row.id !== selfId &&
      row.invoiceNumber.trim().toLowerCase() === wanted,
  );
  if (taken) throw invalid("invoiceNumber", INVOICE_ERRORS.numberTaken);
}

/** Checks the uploaded file of an invoice: it must be ready, of an allowed type and within the size limit. */
function resolveInvoiceFile(db: MockStore, fileId: string): string {
  const file = db.files.find((item) => item.id === fileId);
  if (!file) throw new ServiceError("NOT_FOUND");
  if (file.status !== "READY") throw invalid("fileId", INVOICE_ERRORS.fileNotReady);
  if (!INVOICE_FILE_MIME_TYPES.includes(file.mimeType)) {
    throw invalid("fileId", INVOICE_ERRORS.fileType);
  }
  if (file.sizeBytes > INVOICE_FILE_MAX_BYTES) throw invalid("fileId", INVOICE_ERRORS.fileTooLarge);
  return file.id;
}

/** Runs the C17 totals once, so a bad discount, adjustment or withholding becomes a field error. */
function checkTotals(input: {
  lines: readonly InvoiceLineInput[];
  taxAdjustments: readonly IvaAdjustmentInput[];
  ivaWithheld: MoneyString;
  islrWithheld: MoneyString;
  otherWithheld: MoneyString;
  usdRate: MoneyString;
}) {
  try {
    return computeInvoiceTotals({
      lines: input.lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRate: line.ivaRate,
      })),
      taxAdjustments: input.taxAdjustments,
      ivaWithheld: input.ivaWithheld,
      islrWithheld: input.islrWithheld,
      otherWithheld: input.otherWithheld,
      usdRate: input.usdRate,
    });
  } catch (error) {
    if (error instanceof RangeError) throw invalid("lines", INVOICE_ERRORS.invalidTotals);
    throw error;
  }
}

/**
 * Resolves the lines of an invoice: the rate must be an allowed one (or exempt), the project must belong to the
 * client, and an installment must be live, of the same currency, of a project of the client and not over-billed
 * by the other live invoices (HU-11 CA1, CA5). The installment's status and its billed amount are derived from
 * these lines by the derive pass, so billing an installment marks it `FACTURADA` in the store.
 */
function resolveLines(
  db: MockStore,
  client: ClientRow,
  lines: readonly InvoiceLineInput[],
  currency: string,
  selfId: string | null,
  previous: readonly StoredLine[],
): StoredLine[] {
  const allowed = db.fiscal.ivaRates;
  // One installment is billed once per invoice: a second line for it would bill it twice.
  const billedHere = new Set<string>();
  return lines.map((input, index) => {
    if (input.ivaRate !== null && !isAllowedIvaRate(input.ivaRate, allowed)) {
      throw invalidAt(`lines.${index}.ivaRate`, INVOICE_MESSAGES.ivaRateNotAllowed);
    }

    if (input.installmentId) {
      if (billedHere.has(input.installmentId)) {
        throw invalidAt(`lines.${index}.installmentId`, INVOICE_MESSAGES.duplicateInstallment);
      }
      billedHere.add(input.installmentId);
    }
    const installment = input.installmentId
      ? resolveInstallment(db, client, input, index, currency, selfId)
      : null;
    const projectId = input.projectId ?? installment?.projectId ?? null;
    const project = projectId ? db.projects.find((item) => item.id === projectId) : undefined;
    if (projectId && (!project || project.archivedAt)) throw new ServiceError("NOT_FOUND");
    if (project && !belongsTo(project, client.id)) {
      throw invalidAt(`lines.${index}.projectId`, INVOICE_ERRORS.projectOtherClient);
    }

    // A line keeps its id only when it already belongs to this invoice; any other id is replaced (C14).
    const keepsId = input.id !== undefined && previous.some((item) => item.id === input.id);
    const id = keepsId
      ? (input.id as string)
      : nextMockId(db.idCounters, "inl", (value) =>
          rowsOf(db).some((row) => row.lines.some((item) => item.id === value)),
        );
    return {
      id,
      order: index,
      description: input.description,
      project: project ? { id: project.id, label: project.name, type: "PROJECT" } : null,
      installment: installment
        ? { id: installment.id, label: installment.label, type: "INSTALLMENT" }
        : null,
      quantity: input.quantity,
      unitPrice: roundMoney(input.unitPrice),
      discount: roundMoney(input.discount),
      amount: "0.00",
      netAmount: "0.00",
      ivaRate: input.ivaRate,
    };
  });
}

function resolveInstallment(
  db: MockStore,
  client: ClientRow,
  input: InvoiceLineInput,
  index: number,
  currency: string,
  selfId: string | null,
): InstallmentDTO {
  const installmentId = input.installmentId ?? "";
  const installment = db.installments.find((item) => item.id === installmentId);
  if (!installment) throw new ServiceError("NOT_FOUND");
  const project = db.projects.find((item) => item.id === installment.projectId);
  if (!project || project.archivedAt || !belongsTo(project, client.id)) {
    throw invalidAt(`lines.${index}.installmentId`, INVOICE_ERRORS.projectOtherClient);
  }
  if (installment.cancelledAt !== null) {
    throw invalidAt(`lines.${index}.installmentId`, INVOICE_ERRORS.installmentCancelled);
  }
  if (installment.currency !== currency) {
    throw invalidAt(`lines.${index}.installmentId`, INVOICE_ERRORS.installmentCurrency);
  }
  // What the other live invoices already bill of this installment; this invoice's own lines are replaced.
  const billed = sumMoney(
    billingInvoices(db, selfId).flatMap((row) =>
      row.lines
        .filter((item) => item.installment?.id === installment.id)
        .map((item) => item.netAmount),
    ),
  );
  const remaining = installment.amount;
  const net = computeLineAmounts({
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    discount: input.discount,
    ivaRate: input.ivaRate,
  }).netAmount;
  if (compareMoney(net, subtractSafe(remaining, billed)) > 0) {
    throw invalidAt(`lines.${index}.unitPrice`, INVOICE_ERRORS.installmentExceeded);
  }
  return installment;
}

/** `a − b` for two money strings, floored at zero (a billed amount can never exceed the installment). */
function subtractSafe(a: MoneyString, b: MoneyString): MoneyString {
  return compareMoney(a, b) > 0 ? subMoney(a, b) : "0.00";
}

function taxAdjustmentRows(adjustments: readonly IvaAdjustmentInput[]) {
  return adjustments.map((adjustment) => ({
    ivaRate: adjustment.ivaRate,
    taxBase: "0.00",
    ivaAmount: "0.00",
    adjustment: roundMoney(adjustment.adjustment),
  }));
}

/** The read DTO of a stored invoice: the row, its file, and no service-only fields. */
function toDetail(db: MockStore, row: InvoiceRow): InvoiceDetailDTO {
  const file = row.fileId ? (db.files.find((item) => item.id === row.fileId) ?? null) : null;
  return structuredClone({ ...row, file });
}

function toListRow(row: InvoiceRow): InvoiceListRow {
  const projects = new Map<string, EntityRef>();
  for (const line of row.lines) {
    if (line.project && !projects.has(line.project.id)) projects.set(line.project.id, line.project);
  }
  return {
    id: row.id,
    code: row.code,
    invoiceNumber: row.invoiceNumber,
    client: row.client,
    projects: [...projects.values()],
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    total: row.totals.total,
    balance: row.totals.balance,
    totalUsd: row.totals.totalUsd,
    balanceUsd: row.totals.balanceUsd,
    status: row.status,
    daysOverdue: row.daysOverdue,
    hasPartialPayment: row.hasPartialPayment,
  };
}

async function logInvoice(
  ctx: MockServiceContext,
  action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "DELETE",
  row: InvoiceRow,
) {
  return logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action,
    entityType: "INVOICE",
    entityId: row.id,
    entityLabel: row.invoiceNumber,
    metadata: { clientId: row.client.id },
  });
}

// ───────────────────────────── Reads ─────────────────────────────

const invoiceSpec: ListSpec<InvoiceListRow> = {
  searchText: (row) => [row.code, row.invoiceNumber, row.client.label],
  sorters: {
    code: (row) => row.code,
    invoiceNumber: (row) => row.invoiceNumber,
    issueDate: (row) => row.issueDate,
    dueDate: (row) => row.dueDate,
    total: (row) => row.total,
    totalUsd: (row) => row.totalUsd,
    balance: (row) => row.balance,
    balanceUsd: (row) => row.balanceUsd,
    status: (row) => row.status,
    daysOverdue: (row) => row.daysOverdue,
  },
  defaultSort: "issueDate:desc",
};

/** `/invoices/list` (DT-25): the paginated table; archived invoices stay out unless asked for. */
export async function listInvoices(
  ctx: MockServiceContext,
  input: InvoiceListInput,
): Promise<Paginated<InvoiceListRow>> {
  const rows = rowsOf(ctx.db)
    .filter((row) => input.includeArchived || row.archivedAt === null)
    .filter((row) => !input.status?.length || input.status.includes(row.status))
    .filter((row) => !input.clientId?.length || input.clientId.includes(row.client.id))
    .filter((row) => !input.currency?.length || input.currency.includes(row.currency))
    .filter(
      (row) =>
        !input.projectId?.length ||
        row.lines.some((line) => line.project && input.projectId?.includes(line.project.id)),
    )
    .filter((row) => !input.dateFrom || row.issueDate >= input.dateFrom)
    .filter((row) => !input.dateTo || row.issueDate <= input.dateTo)
    .map(toListRow);
  return listRows(
    rows,
    {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
      sort: input.sort,
      q: input.q,
    },
    invoiceSpec,
  );
}

/** One invoice with its lines, tax lines, totals, allocations and file (`/invoices/[id]`). */
export async function getInvoice(ctx: MockServiceContext, id: string): Promise<InvoiceDetailDTO> {
  return toDetail(ctx.db, findInvoice(ctx.db, id));
}

/** Client-side input of the "Facturar cuotas" wizard: the PENDIENTE installments of the client's projects. */
export async function listBillableInstallments(
  ctx: MockServiceContext,
  clientId: string,
): Promise<BillableInstallmentRow[]> {
  const client = liveClient(ctx.db, clientId);
  const projects = new Map(
    ctx.db.projects
      .filter((project) => !project.archivedAt && belongsTo(project, client.id))
      .map((project) => [project.id, project]),
  );
  return ctx.db.installments
    .filter((item) => projects.has(item.projectId) && item.status === "PENDIENTE")
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const project = projects.get(item.projectId);
      return {
        installment: { id: item.id, label: item.label, type: "INSTALLMENT" },
        project: { id: item.projectId, label: project?.name ?? "", type: "PROJECT" },
        kind: item.kind,
        label: item.label,
        currency: item.currency,
        amount: item.amount,
        remainingAmount: subtractSafe(item.amount, item.invoicedAmount),
        dueDate: item.dueDate,
      };
    });
}

/** `YYYY-MM` of the month `offset` months away from the business day `today`. */
function monthKeyOffset(today: DateOnly, offset: number): string {
  const [year = 0, month = 1] = today.slice(0, 7).split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * `/invoices` overview (DT-25, not the list): billed against collected per month (USD), the open receivable by days
 * past due, the count of overdue invoices and the open totals per currency. Voided, archived and draft invoices
 * are left out; a payment counts as collected on its own day (confirmed payments only).
 */
export async function getInvoicesOverview(ctx: MockServiceContext): Promise<InvoicesOverviewDTO> {
  const { db } = ctx;
  const today: DateOnly = todayInCaracas(ctx.now);
  const periods = Array.from({ length: 6 }, (_, index) => monthKeyOffset(today, index - 5));
  const live = rowsOf(db).filter(
    (row) => row.voidedAt === null && row.archivedAt === null && !row.isDraft,
  );
  const billed = periods.map((period) =>
    sumMoney(
      live.filter((row) => row.issueDate.startsWith(period)).map((row) => row.totals.totalUsd),
    ),
  );
  const collected = periods.map((period) =>
    sumMoney(
      db.paymentAllocations
        .filter((allocation) => {
          const payment = db.payments.find((item) => item.id === allocation.paymentId);
          return (
            payment !== undefined &&
            payment.status === "CONFIRMADO" &&
            payment.date.startsWith(period)
          );
        })
        .map((allocation) => allocation.amountUsd),
    ),
  );

  const open = live.filter((row) => compareMoney(row.totals.balance, "0") > 0);
  const aging = { d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00" };
  for (const row of open) {
    const bucket =
      row.daysOverdue <= 30
        ? "d0_30"
        : row.daysOverdue <= 60
          ? "d31_60"
          : row.daysOverdue <= 90
            ? "d61_90"
            : "d90plus";
    aging[bucket] = sumMoney([aging[bucket], row.totals.balanceUsd]);
  }

  const currencies = [...new Set(live.map((row) => row.currency))].sort();
  return {
    billedVsCollected: {
      periods,
      series: [
        { id: "billed", values: billed },
        { id: "collected", values: collected },
      ],
    },
    aging,
    overdueCount: open.filter((row) => row.status === "VENCIDA").length,
    totalsByCurrency: currencies.map((currency) => {
      const rows = live.filter((row) => row.currency === currency);
      return {
        currency,
        total: sumMoney(rows.map((row) => row.totals.total)),
        balance: sumMoney(rows.map((row) => row.totals.balance)),
        overdue: sumMoney(
          rows.filter((row) => row.status === "VENCIDA").map((row) => row.totals.balance),
        ),
      };
    }),
  };
}

// ───────────────────────────── Mutations (HU-11, HU-12) ─────────────────────────────

/**
 * Registers an invoice (lines, IVA adjustments, withholdings, optional file). The number must be unique among the
 * non-archived invoices (CA3). Installments on the lines are billed at save (CA5): the derive pass marks them
 * `FACTURADA`. Every total and status is derived by the store, never typed here (C17).
 */
export async function createInvoice(
  ctx: MockServiceContext,
  input: CreateInvoiceInput,
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const client = liveClient(db, input.clientId);
  assertNumberFree(db, input.invoiceNumber, null);
  const lines = resolveLines(db, client, input.lines, input.currency, null, []);
  checkTotals(input);

  const row: InvoiceRow = {
    id: nextMockId(db.idCounters, "inv", (value) => rowsOf(db).some((item) => item.id === value)),
    code: nextMockCode(db.sequences, "FAC"),
    client: { id: client.id, label: client.tradeName, type: "CLIENT" },
    invoiceNumber: input.invoiceNumber.trim(),
    controlNumber: input.controlNumber ?? null,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    usdRate: input.usdRate,
    bcvRate: input.bcvRate ?? null,
    isDraft: input.isDraft,
    status: "BORRADOR",
    voidedAt: null,
    voidReason: null,
    fileId: input.fileId ? resolveInvoiceFile(db, input.fileId) : null,
    file: null,
    lines,
    taxLines: taxAdjustmentRows(input.taxAdjustments),
    totals: withholdingTotals(input),
    allocations: [],
    daysOverdue: 0,
    hasPartialPayment: false,
    createdAt: ctx.now.toISOString(),
    updatedAt: ctx.now.toISOString(),
    createdById: ctx.user.id,
    archivedAt: null,
  };
  db.invoices.push(row);
  deriveMockStore(db);
  await logInvoice(ctx, "CREATE", row);
  return toDetail(db, row);
}

/** Withholdings and the note, as stored; the derived totals are filled by the derive pass. */
function withholdingTotals(input: {
  ivaWithheld: MoneyString;
  islrWithheld: MoneyString;
  otherWithheld: MoneyString;
  otherWithheldNote?: string | undefined;
}): InvoiceRow["totals"] {
  const zero = "0.00";
  return {
    subtotal: zero,
    discount: zero,
    exemptAmount: zero,
    taxBase: zero,
    ivaAmount: zero,
    total: zero,
    ivaWithheld: roundMoney(input.ivaWithheld),
    islrWithheld: roundMoney(input.islrWithheld),
    otherWithheld: roundMoney(input.otherWithheld),
    otherWithheldNote: input.otherWithheldNote ?? null,
    receivable: zero,
    totalUsd: zero,
    receivableUsd: zero,
    paidAmount: zero,
    balance: zero,
    balanceUsd: zero,
  };
}

/**
 * Edits an invoice (the whole invoice again). A voided or archived invoice is read-only. An invoice with active
 * allocations keeps its client and currency, and its receivable cannot drop below what is already allocated.
 */
export async function updateInvoice(
  ctx: MockServiceContext,
  input: UpdateInvoiceInput,
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const row = findInvoice(db, input.id);
  if (row.archivedAt !== null) throw invalid("id", INVOICE_ERRORS.archived);
  if (row.voidedAt !== null) throw new ServiceError("CONFLICT", { message: INVOICE_ERRORS.voided });
  assertNumberFree(db, input.invoiceNumber, row.id);
  const client = liveClient(db, input.clientId);
  const allocations = activeAllocations(db, row.id);
  if (allocations.length > 0 && (client.id !== row.client.id || input.currency !== row.currency)) {
    throw new ServiceError("INTEGRITY_LOCK", { message: INVOICE_ERRORS.clientLocked });
  }

  const lines = resolveLines(db, client, input.lines, input.currency, row.id, row.lines);
  const totals = checkTotals(input);
  const allocated = sumMoney(allocations.map((allocation) => allocation.amountInvoiceCurrency));
  if (compareMoney(totals.receivable, allocated) < 0) {
    throw new ServiceError("INTEGRITY_LOCK", { message: INVOICE_ERRORS.receivableBelowPaid });
  }

  row.client = { id: client.id, label: client.tradeName, type: "CLIENT" };
  row.invoiceNumber = input.invoiceNumber.trim();
  row.controlNumber = input.controlNumber ?? null;
  row.issueDate = input.issueDate;
  row.dueDate = input.dueDate;
  row.currency = input.currency;
  row.usdRate = input.usdRate;
  row.bcvRate = input.bcvRate ?? null;
  row.isDraft = input.isDraft;
  if (input.fileId !== undefined) row.fileId = resolveInvoiceFile(db, input.fileId);
  row.lines = lines;
  row.taxLines = taxAdjustmentRows(input.taxAdjustments);
  row.totals = withholdingTotals(input);
  row.updatedAt = ctx.now.toISOString();

  deriveMockStore(db);
  await logInvoice(ctx, "UPDATE", row);
  return toDetail(db, row);
}

/** Turns a draft into an issued invoice: its totals start to count for billing (HU-11). */
export async function issueDraft(
  ctx: MockServiceContext,
  input: { id: string },
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const row = findInvoice(db, input.id);
  if (row.voidedAt !== null) throw new ServiceError("CONFLICT", { message: INVOICE_ERRORS.voided });
  if (!row.isDraft) throw new ServiceError("CONFLICT", { message: INVOICE_ERRORS.notDraft });
  row.isDraft = false;
  row.updatedAt = ctx.now.toISOString();
  deriveMockStore(db);
  await logInvoice(ctx, "UPDATE", row);
  return toDetail(db, row);
}

/**
 * Annuls an invoice with a mandatory reason (HU-12 CA5). Refused while a payment allocates to it: those allocations
 * must be removed first, so the payments keep their credit balance.
 */
export async function voidInvoice(
  ctx: MockServiceContext,
  input: VoidInvoiceInput,
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const row = findInvoice(db, input.id);
  if (row.voidedAt !== null) {
    throw new ServiceError("CONFLICT", { message: INVOICE_ERRORS.alreadyVoided });
  }
  if (activeAllocations(db, row.id).length > 0) {
    throw new ServiceError("INTEGRITY_LOCK", { message: INVOICE_ERRORS.hasAllocations });
  }
  row.voidedAt = ctx.now.toISOString();
  row.voidReason = input.reason;
  row.updatedAt = ctx.now.toISOString();
  deriveMockStore(db);
  await logInvoice(ctx, "STATUS_CHANGE", row);
  return toDetail(db, row);
}

/**
 * Archives an invoice: it leaves the lists and frees its number (CA3). An invoice with allocations is voided, not
 * archived (integrity lock).
 */
export async function archiveInvoice(
  ctx: MockServiceContext,
  input: { id: string },
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const row = findInvoice(db, input.id);
  if (row.archivedAt !== null) {
    throw new ServiceError("CONFLICT", { message: INVOICE_ERRORS.alreadyArchived });
  }
  if (activeAllocations(db, row.id).length > 0) {
    throw new ServiceError("INTEGRITY_LOCK", { message: INVOICE_ERRORS.hasAllocations });
  }
  row.archivedAt = ctx.now.toISOString();
  row.updatedAt = ctx.now.toISOString();
  deriveMockStore(db);
  await logInvoice(ctx, "DELETE", row);
  return toDetail(db, row);
}

/** Attaches (or detaches, with `null`) the PDF of the real invoice (HU-11 CA4, HU-14 CA1). */
export async function attachInvoiceFile(
  ctx: MockServiceContext,
  input: { id: string; fileId: string | null },
): Promise<InvoiceDetailDTO> {
  const { db } = ctx;
  const row = findInvoice(db, input.id);
  if (row.archivedAt !== null) throw invalid("id", INVOICE_ERRORS.archived);
  row.fileId = input.fileId === null ? null : resolveInvoiceFile(db, input.fileId);
  row.updatedAt = ctx.now.toISOString();
  await logInvoice(ctx, "UPDATE", row);
  return toDetail(db, row);
}
