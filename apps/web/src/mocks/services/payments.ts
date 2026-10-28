// MOCK — payment services of H1-B3 (PRD §8.6, §9.5, §9.6, §12 `payments`). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/payments.service.ts` in Hito 2 (C9).
// Amounts are never computed here: `allocatable`, `netCredited`, `allocated`, `unallocated` and the invoice paid
// figures come from the derive pass (`derive-finance.ts`, C17). This module only decides what may be written and
// stores the inputs. IGTF and fee amounts are proposed from the fiscal settings (DT-70), and USD snapshots are
// stored at write time and never recomputed (§9).
import type { DateOnly } from "@/lib/dates";
import { todayInCaracas } from "@/lib/dates";
import { allocationProblems, computePaymentAmounts, type AllocationCheck } from "@/lib/finance";
import {
  compareMoney,
  roundMoney,
  roundRate,
  sumMoney,
  toUsd,
  type MoneyString,
} from "@/lib/money";
import type { InvoiceStatus } from "@/lib/validators/enums";
import type { BreakdownItem } from "@/lib/validators/dashboard";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import {
  PAYMENT_MESSAGES,
  createPaymentInputSchemaFor,
  type AllocatePaymentInput,
  type CreatePaymentInput,
  type DeallocatePaymentInput,
  type DetectDuplicatePaymentInput,
  type DuplicatePaymentWarningDTO,
  type PaymentAllocationDTO,
  type PaymentDetailDTO,
  type PaymentFilters,
  type PaymentListRow,
  type PaymentsOverviewDTO,
} from "@/lib/validators/payments";
import { checkUpload } from "@/lib/validators/files";
import type { OpenInvoiceOption } from "@/features/payments/types";
import { DEFAULT_PAGE_SIZE, type EntityRef, type Paginated } from "@/lib/validators/common";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockCode, nextMockId } from "../ids";
import { deriveMockStore, type MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

/** Messages this module adds to `PAYMENT_MESSAGES` (keys of `payments.json`). */
export const PAYMENT_SERVICE_MESSAGES = {
  currencyMismatch: "payments.validation.currencyMismatch",
  allocationExceedsBalance: "payments.validation.allocationExceedsBalance",
  allocationInvoiceNotOpen: "payments.validation.allocationInvoiceNotOpen",
  allocationSameCurrency: "payments.validation.allocationSameCurrency",
  accountInactive: "accounts.validation.inactive",
  paymentNotConfirmed: "payments.validation.paymentNotConfirmed",
} as const;

/** Invoice statuses that still take a payment (HU-12): issued, partially paid or overdue. */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ["EMITIDA", "PARCIAL", "VENCIDA"];

/** Credit (saldo a favor) of one client: what its confirmed payments did not apply (HU-13 CA5). */
export type ClientCreditDTO = {
  totalUsd: MoneyString;
  payments: {
    paymentId: string;
    code: string;
    date: DateOnly;
    currency: string;
    unallocated: MoneyString;
    unallocatedUsd: MoneyString;
  }[];
};

const orNull = <T>(value: T | undefined): T | null => value ?? null;
const normalizeReference = (reference: string) => reference.trim().toLowerCase();

function refOf(type: EntityRef["type"], id: string, label: string): EntityRef {
  return { id, label, type };
}

function findPayment(db: MockStore, id: string): PaymentDetailDTO {
  const row = db.payments.find((payment) => payment.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function findClient(db: MockStore, id: string) {
  const row = db.clients.find((client) => client.id === id && !client.archivedAt);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function findAccount(db: MockStore, id: string) {
  const row = db.accounts.find((account) => account.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function findMethod(db: MockStore, id: string) {
  const row = db.paymentMethods.find((method) => method.id === id && method.active);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function findInvoice(db: MockStore, id: string): InvoiceDetailDTO {
  const row = db.invoices.find((invoice) => invoice.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function isOpenInvoice(invoice: InvoiceDetailDTO): boolean {
  return (
    invoice.voidedAt === null &&
    OPEN_INVOICE_STATUSES.includes(invoice.status) &&
    compareMoney(invoice.totals.balance, "0") > 0
  );
}

function openOption(invoice: InvoiceDetailDTO): OpenInvoiceOption {
  return {
    id: invoice.id,
    code: invoice.code,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    usdRate: invoice.usdRate,
    dueDate: invoice.dueDate,
    balance: invoice.totals.balance,
    status: invoice.status,
  };
}

/** Payment DTO: resolves the labels of the allocations and the receipt from the store (services assemble DTOs). */
function toPaymentDTO(db: MockStore, row: PaymentDetailDTO): PaymentDetailDTO {
  const receipt = row.receiptFileId
    ? (db.files.find((file) => file.id === row.receiptFileId) ?? null)
    : null;
  return structuredClone({
    ...row,
    receipt,
    allocations: row.allocations.map((allocation) => ({
      ...allocation,
      invoice: {
        ...allocation.invoice,
        label:
          db.invoices.find((invoice) => invoice.id === allocation.invoice.id)?.code ??
          allocation.invoice.label,
      },
    })),
  });
}

// ───────────────────────────── Reads ─────────────────────────────

const paymentSpec: ListSpec<PaymentListRow> = {
  searchText: (row) => [row.code, row.client.label, row.reference, row.account.label],
  sorters: {
    code: (row) => row.code,
    date: (row) => row.date,
    amount: (row) => row.amount,
    amountUsd: (row) => row.amountUsd,
    allocated: (row) => row.allocated,
    unallocated: (row) => row.unallocated,
    reference: (row) => row.reference ?? "",
    status: (row) => row.status,
  },
  defaultSort: "date:desc",
};

function listRow(row: PaymentDetailDTO): PaymentListRow {
  return {
    id: row.id,
    code: row.code,
    date: row.date,
    client: row.client,
    method: row.method,
    account: row.account,
    currency: row.currency,
    amount: row.amount,
    amountUsd: row.amountUsd,
    allocated: row.allocated,
    unallocated: row.unallocated,
    reference: row.reference,
    status: row.status,
  };
}

/** Payments of the table, filtered by the facets; the derived columns come from the store. */
export async function listPayments(
  ctx: MockServiceContext,
  input: PaymentFilters,
): Promise<Paginated<PaymentListRow>> {
  const rows = ctx.db.payments
    .filter((row) => !input.status || input.status.includes(row.status))
    .filter((row) => !input.clientId || input.clientId.includes(row.client.id))
    .filter((row) => !input.accountId || input.accountId.includes(row.account.id))
    .filter((row) => !input.methodId || input.methodId.includes(row.method.id))
    .filter((row) => !input.currency || input.currency.includes(row.currency))
    .filter((row) => !input.dateFrom || row.date >= input.dateFrom)
    .filter((row) => !input.dateTo || row.date <= input.dateTo)
    .filter((row) => !input.hasUnallocated || compareMoney(row.unallocated, "0") > 0)
    .map(listRow);
  return listRows(
    rows,
    {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
      sort: input.sort,
      q: input.q,
    },
    paymentSpec,
  );
}

/** The last `count` month keys (`YYYY-MM`) up to the month of `today`, oldest first. */
function monthKeys(today: DateOnly, count: number): string[] {
  const [year = 0, month = 1] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const serial = year * 12 + (month - 1) - (count - 1 - index);
    const y = Math.floor(serial / 12);
    const m = (serial % 12) + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

/** Sums USD values per key, in first-seen order (breakdown charts). */
function breakdown<T>(
  rows: readonly T[],
  pick: (row: T) => { key: string; label: string },
  usd: (row: T) => MoneyString,
): BreakdownItem[] {
  const groups = new Map<string, { label: string; values: MoneyString[] }>();
  for (const row of rows) {
    const { key, label } = pick(row);
    const group = groups.get(key) ?? { label, values: [] };
    group.values.push(usd(row));
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    value: sumMoney(group.values),
  }));
}

/** `/payments` overview (DT-25): collected USD per month (confirmed payments), breakdowns and the open queues. */
export async function getPaymentsOverview(ctx: MockServiceContext): Promise<PaymentsOverviewDTO> {
  const confirmed = ctx.db.payments.filter((row) => row.status === "CONFIRMADO");
  const months = monthKeys(todayInCaracas(ctx.now), 12);
  const unallocated = confirmed.filter((row) => compareMoney(row.unallocated, "0") > 0);
  return {
    collectedByMonth: months.map((period) => ({
      period,
      value: sumMoney(
        confirmed.filter((row) => row.date.startsWith(period)).map((row) => row.amountUsd),
      ),
    })),
    byMethod: breakdown(
      confirmed,
      (row) => ({ key: row.method.code, label: row.method.name }),
      (row) => row.amountUsd,
    ),
    byAccount: breakdown(
      confirmed,
      (row) => ({ key: row.account.id, label: row.account.label }),
      (row) => row.amountUsd,
    ),
    pendingVerificationCount: ctx.db.payments.filter(
      (row) => row.status === "PENDIENTE_VERIFICACION",
    ).length,
    unallocatedCount: unallocated.length,
    unallocatedTotalUsd: sumMoney(unallocated.map((row) => toUsd(row.unallocated, row.usdRate))),
  };
}

export async function getPayment(ctx: MockServiceContext, id: string): Promise<PaymentDetailDTO> {
  return toPaymentDTO(ctx.db, findPayment(ctx.db, id));
}

/** Open invoices of a client (HU-13 CA1 "Aplicar a facturas"): issued, partially paid or overdue, with a balance. */
export async function listOpenInvoicesForClient(
  ctx: MockServiceContext,
  clientId: string,
): Promise<OpenInvoiceOption[]> {
  findClient(ctx.db, clientId);
  return ctx.db.invoices
    .filter((invoice) => invoice.client.id === clientId && isOpenInvoice(invoice))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .map(openOption);
}

/**
 * The invoice a new payment starts from (`/payments/new?invoiceId=`): its client and its option, or `null` when
 * the invoice is unknown or no longer takes a payment (the form then opens empty).
 */
export async function getInvoiceForPayment(
  ctx: MockServiceContext,
  invoiceId: string,
): Promise<{ client: EntityRef; invoice: OpenInvoiceOption } | null> {
  const invoice = ctx.db.invoices.find((row) => row.id === invoiceId);
  if (!invoice || !isOpenInvoice(invoice)) return null;
  return { client: invoice.client, invoice: openOption(invoice) };
}

/** Saldo a favor of a client (HU-13 CA5), for its page and for the payment form. Only confirmed payments count. */
export async function getClientCredit(
  ctx: MockServiceContext,
  clientId: string,
): Promise<ClientCreditDTO> {
  findClient(ctx.db, clientId);
  const items = ctx.db.payments
    .filter(
      (row) =>
        row.client.id === clientId &&
        row.status === "CONFIRMADO" &&
        compareMoney(row.unallocated, "0") > 0,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((row) => ({
      paymentId: row.id,
      code: row.code,
      date: row.date,
      currency: row.currency,
      unallocated: row.unallocated,
      unallocatedUsd: toUsd(row.unallocated, row.usdRate),
    }));
  return { totalUsd: sumMoney(items.map((item) => item.unallocatedUsd)), payments: items };
}

/**
 * Possible duplicates (HU-13 CA6): same reference, method and account, not voided. A warning only: the caller
 * shows it and the payment can still be saved.
 */
export async function detectDuplicatePayment(
  ctx: MockServiceContext,
  input: DetectDuplicatePaymentInput,
): Promise<DuplicatePaymentWarningDTO> {
  const key = normalizeReference(input.reference);
  const matches = ctx.db.payments
    .filter(
      (row) =>
        row.id !== input.excludePaymentId &&
        row.status !== "ANULADO" &&
        row.method.id === input.methodId &&
        row.account.id === input.accountId &&
        row.reference !== null &&
        normalizeReference(row.reference) === key,
    )
    .map((row) => ({
      payment: refOf("PAYMENT", row.id, row.code),
      date: row.date,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
    }));
  return { duplicate: matches.length > 0, matches };
}

// ───────────────────────────── Allocation checks ─────────────────────────────

type AllocationDraft = {
  invoiceId: string;
  amountPaymentCurrency: MoneyString;
  amountInvoiceCurrency: MoneyString;
};

/**
 * Validates one or more allocations against the payment (HU-13 CA3): the invoice belongs to the client and is open,
 * the same-currency amounts match, and the total does not exceed the allocatable amount. `existing` are the
 * allocations already stored on the payment, which count toward the total but not toward the invoice balance.
 */
function checkAllocations(
  db: MockStore,
  payment: { clientId: string; currency: string; allocatable: MoneyString },
  drafts: readonly AllocationDraft[],
  existing: readonly PaymentAllocationDTO[],
): void {
  const fieldErrors: Record<string, string[]> = {};
  // Checks of the drafts that passed the invoice rules, with the index of their draft.
  const checks: { draft: number; check: AllocationCheck }[] = [];
  drafts.forEach((draft, index) => {
    const invoice = findInvoice(db, draft.invoiceId);
    if (invoice.client.id !== payment.clientId || !isOpenInvoice(invoice)) {
      fieldErrors[`allocations.${index}.invoiceId`] = [
        PAYMENT_SERVICE_MESSAGES.allocationInvoiceNotOpen,
      ];
      return;
    }
    if (
      invoice.currency === payment.currency &&
      compareMoney(draft.amountInvoiceCurrency, draft.amountPaymentCurrency) !== 0
    ) {
      fieldErrors[`allocations.${index}.amountInvoiceCurrency`] = [
        PAYMENT_SERVICE_MESSAGES.allocationSameCurrency,
      ];
    }
    checks.push({
      draft: index,
      check: {
        amountPaymentCurrency: draft.amountPaymentCurrency,
        amountInvoiceCurrency: draft.amountInvoiceCurrency,
        invoiceBalance: invoice.totals.balance,
      },
    });
  });
  if (Object.keys(fieldErrors).length === 0) {
    // The stored allocations go first as one row (index 0): they count toward the allocatable total, which
    // allocationProblems sums together with the drafts, but never toward an invoice balance.
    const existingTotal = sumMoney(existing.map((allocation) => allocation.amountPaymentCurrency));
    const problems = allocationProblems(payment.allocatable, [
      { amountPaymentCurrency: existingTotal, amountInvoiceCurrency: "0", invoiceBalance: "0" },
      ...checks.map((item) => item.check),
    ]);
    for (const problem of problems) {
      if (problem.kind === "exceedsAllocatable") {
        fieldErrors.allocations = [PAYMENT_MESSAGES.allocationsExceedAllocatable];
        continue;
      }
      const item = checks[problem.index - 1];
      if (item) {
        fieldErrors[`allocations.${item.draft}.amountInvoiceCurrency`] = [
          PAYMENT_SERVICE_MESSAGES.allocationExceedsBalance,
        ];
      }
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ServiceError("VALIDATION", { fieldErrors });
  }
}

/** Stores the allocation rows of a payment; the invoices and the payment are recomputed by the derive pass. */
function storeAllocations(
  db: MockStore,
  payment: PaymentDetailDTO,
  drafts: readonly AllocationDraft[],
  now: Date,
): PaymentAllocationDTO[] {
  return drafts.map((draft) => {
    const invoice = findInvoice(db, draft.invoiceId);
    const row: PaymentAllocationDTO = {
      id: nextMockId(db.idCounters, "alo", (id) =>
        db.paymentAllocations.some((item) => item.id === id),
      ),
      paymentId: payment.id,
      invoice: refOf("INVOICE", invoice.id, invoice.code),
      invoiceCurrency: invoice.currency,
      amountPaymentCurrency: roundMoney(draft.amountPaymentCurrency),
      amountInvoiceCurrency: roundMoney(draft.amountInvoiceCurrency),
      // USD snapshot of the applied amount at the payment rate, stored once (§9).
      amountUsd: toUsd(roundMoney(draft.amountPaymentCurrency), payment.usdRate),
      createdAt: now.toISOString(),
    };
    db.paymentAllocations.push(row);
    return row;
  });
}

// ───────────────────────────── Writes ─────────────────────────────

/**
 * Registers a payment (HU-13): the method decides whether a reference is required (CA1), the IGTF and fee cannot
 * exceed the amount, and the allocations go to the client's open invoices within the allocatable amount and each
 * invoice balance (CA3, CA4). The unallocated rest is the client's credit (CA5). Duplicates are not refused here
 * (CA6 is a warning, read through `detectDuplicatePayment`).
 */
export async function createPayment(
  ctx: MockServiceContext,
  input: CreatePaymentInput,
): Promise<PaymentDetailDTO> {
  const client = findClient(ctx.db, input.clientId);
  const account = findAccount(ctx.db, input.accountId);
  const method = findMethod(ctx.db, input.methodId);
  if (!account.active) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { accountId: [PAYMENT_SERVICE_MESSAGES.accountInactive] },
    });
  }
  if (account.currency !== input.currency) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { currency: [PAYMENT_SERVICE_MESSAGES.currencyMismatch] },
    });
  }
  // The method is data: the reference rule is checked here with its `requiresReference` (§8.6).
  const parsed = createPaymentInputSchemaFor({
    requiresReference: method.requiresReference,
  }).safeParse(input);
  if (!parsed.success) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: flattenIssues(parsed.error.issues),
    });
  }
  const values = parsed.data;

  let receiptFileId: string | null = null;
  if (values.receiptFileId) {
    const file = ctx.db.files.find((row) => row.id === values.receiptFileId);
    if (!file || file.status !== "READY") throw new ServiceError("NOT_FOUND");
    const violation = checkUpload(
      { name: file.originalName, mime: file.mimeType, size: file.sizeBytes },
      "payment_receipt",
    );
    if (violation) {
      throw new ServiceError("VALIDATION", { fieldErrors: { receiptFileId: [violation.key] } });
    }
    receiptFileId = file.id;
  }

  const amount = roundMoney(values.amount);
  const igtfAmount = roundMoney(values.igtfAmount);
  const feeAmount = roundMoney(values.feeAmount);
  const allocatable = computePaymentAmounts({
    amount,
    igtfAmount,
    feeAmount,
    allocated: [],
  }).allocatable;
  const drafts: AllocationDraft[] = values.allocations.map((allocation) => ({
    invoiceId: allocation.invoiceId,
    amountPaymentCurrency: allocation.amountPaymentCurrency,
    amountInvoiceCurrency: allocation.amountInvoiceCurrency,
  }));
  checkAllocations(
    ctx.db,
    { clientId: client.id, currency: values.currency, allocatable },
    drafts,
    [],
  );

  const now = ctx.now.toISOString();
  const usdRate = roundRate(values.usdRate);
  const row: PaymentDetailDTO = {
    id: nextMockId(ctx.db.idCounters, "pag", (id) =>
      ctx.db.payments.some((item) => item.id === id),
    ),
    code: nextMockCode(ctx.db.sequences, "PAG"),
    date: values.date,
    client: refOf("CLIENT", client.id, client.tradeName),
    method: {
      id: method.id,
      code: method.code,
      name: method.name,
      nameEn: method.nameEn,
    },
    account: refOf("ACCOUNT", account.id, account.name),
    currency: values.currency,
    amount,
    amountUsd: toUsd(amount, usdRate),
    // Derived by the derive pass below; placeholders until then.
    allocated: "0.00",
    unallocated: "0.00",
    reference: orNull(values.reference),
    status: values.status,
    igtfAmount,
    feeAmount,
    netCredited: "0.00",
    allocatable: "0.00",
    usdRate,
    receiptFileId,
    receipt: null,
    allocations: [],
    createdAt: now,
    updatedAt: now,
    createdById: ctx.user.id,
  };
  ctx.db.payments.push(row);
  storeAllocations(ctx.db, row, drafts, ctx.now);
  deriveMockStore(ctx.db);

  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "PAYMENT",
    entityId: row.id,
    entityLabel: row.code,
  });
  return toPaymentDTO(ctx.db, findPayment(ctx.db, row.id));
}

/** Applies one more amount of a confirmed payment to an open invoice (same checks as at creation, HU-13 CA3). */
export async function allocatePayment(
  ctx: MockServiceContext,
  input: AllocatePaymentInput,
): Promise<PaymentAllocationDTO> {
  const payment = findPayment(ctx.db, input.paymentId);
  if (payment.status !== "CONFIRMADO") {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { paymentId: [PAYMENT_SERVICE_MESSAGES.paymentNotConfirmed] },
    });
  }
  const draft: AllocationDraft = {
    invoiceId: input.invoiceId,
    amountPaymentCurrency: input.amountPaymentCurrency,
    amountInvoiceCurrency: input.amountInvoiceCurrency,
  };
  const existing = ctx.db.paymentAllocations.filter((row) => row.paymentId === payment.id);
  checkAllocations(
    ctx.db,
    { clientId: payment.client.id, currency: payment.currency, allocatable: payment.allocatable },
    [draft],
    existing,
  );
  const [row] = storeAllocations(ctx.db, payment, [draft], ctx.now);
  if (!row) throw new ServiceError("VALIDATION");
  deriveMockStore(ctx.db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "UPDATE",
    entityType: "PAYMENT",
    entityId: payment.id,
    entityLabel: payment.code,
  });
  return structuredClone(row);
}

/** Removes an application: the payment goes back to its credit and the invoice balance is recomputed. */
export async function deallocatePayment(
  ctx: MockServiceContext,
  input: DeallocatePaymentInput,
): Promise<PaymentDetailDTO> {
  const index = ctx.db.paymentAllocations.findIndex((row) => row.id === input.allocationId);
  const allocation = ctx.db.paymentAllocations[index];
  if (!allocation) throw new ServiceError("NOT_FOUND");
  const payment = findPayment(ctx.db, allocation.paymentId);
  ctx.db.paymentAllocations.splice(index, 1);
  deriveMockStore(ctx.db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "UPDATE",
    entityType: "PAYMENT",
    entityId: payment.id,
    entityLabel: payment.code,
  });
  return toPaymentDTO(ctx.db, findPayment(ctx.db, payment.id));
}

/** Flattens Zod issues into the `fieldErrors` shape of the service errors (first message per path). */
function flattenIssues(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "root";
    out[key] ??= [issue.message];
  }
  return out;
}
