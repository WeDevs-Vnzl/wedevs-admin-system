import type { Actor } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type {
  RowLockSet,
  RowLocksPort,
} from '../../../../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { ActivityAction, InvoiceStatus } from '../../../../../shared/domain/enums';
import {
  compareMoney,
  roundMoney,
  sumMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { PAYMENT_ERRORS } from '../../../domain/errors';
import { allocationProblems, computePaymentAmounts } from '../../../domain/payments';
import type { FinanceProjector } from '../../finance-projector';
import type { InvoiceRecord, InvoiceRepository } from '../../ports/invoice.repository.port';
import type {
  PaymentAccountRef,
  PaymentMethodRule,
  PaymentReceiptFilesPort,
  PaymentReferencesPort,
} from '../../ports/payment-references.port';
import type {
  PaymentAllocationRecord,
  PaymentRecord,
  PaymentRepository,
  PaymentView,
} from '../../ports/payment.repository.port';
import type { InvoiceSupport } from '../invoices/invoice-support';
import type { RecomputeInvoice } from '../invoices/recompute-invoice.use-case';
import { addError } from '../expenses/expense-support';
import {
  PAYMENT_MESSAGES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MIME_TYPES,
  type AllocationInput,
} from './payment-input';

/** Invoice statuses that still take a payment (HU-12): issued, partially paid or overdue. */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ['EMITIDA', 'PARCIAL', 'VENCIDA'];

/** Fields the `UPDATE` entry compares. */
export const PAYMENT_ACTIVITY_FIELDS = [
  'clientId',
  'date',
  'accountId',
  'methodId',
  'currency',
  'amount',
  'igtfAmount',
  'feeAmount',
  'usdRate',
  'reference',
  'receiptFileId',
] as const;

/** A payment as the routes return it: the stored columns, the labels and the live allocations. */
export type PaymentOutput = PaymentView;

/** The part of the projector a payment mutation uses. */
export type PaymentProjector = Pick<
  FinanceProjector,
  'projectPayment' | 'projectAccount' | 'projectClients' | 'projectProjects'
>;

/** What payments need of the invoice slice: the search entry (a recompute changes the status it shows). */
export type PaymentInvoiceApi = Pick<InvoiceSupport, 'reindex'>;
export type InvoiceRecomputer = Pick<RecomputeInvoice, 'execute'>;

export const unique = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === 'string')),
];

const isSubset = (inner: readonly string[], outer: readonly string[]): boolean =>
  inner.every((id) => outer.includes(id));

export function todayOf(clock: ClockPort): DateOnly {
  return todayInCaracas(clock.now());
}

/** What a mutation may touch, read before the unit of work to know which rows to lock. */
export interface PlanArgs {
  readonly paymentId?: string | null;
  readonly clientIds?: readonly (string | null | undefined)[];
  readonly accountIds?: readonly (string | null | undefined)[];
  readonly invoiceIds?: readonly (string | null | undefined)[];
}

export interface LockPlan {
  readonly args: PlanArgs;
  readonly paymentId: string | null;
  readonly clientIds: readonly string[];
  readonly accountIds: readonly string[];
  /** The named invoices plus the ones the payment has live allocations to. */
  readonly invoiceIds: readonly string[];
  readonly installmentIds: readonly string[];
  readonly projectIds: readonly string[];
}

/** An invoice takes a payment while it is live, not voided, in an open status and has a balance (HU-12). */
export function isOpenInvoice(invoice: InvoiceRecord): boolean {
  return (
    invoice.archivedAt === null &&
    invoice.voidedAt === null &&
    OPEN_INVOICE_STATUSES.includes(invoice.status) &&
    compareMoney(invoice.balance, '0') > 0
  );
}

/** The cached columns of a payment that follow from its amounts and its live allocations (§9.6, C17). */
export function derivedColumns(
  fields: { amount: MoneyString; igtfAmount: MoneyString; feeAmount: MoneyString },
  live: readonly PaymentAllocationRecord[],
): Pick<PaymentRecord, 'allocatable' | 'netCredited' | 'unallocated'> {
  return computePaymentAmounts({
    amount: fields.amount,
    igtfAmount: fields.igtfAmount,
    feeAmount: fields.feeAmount,
    allocated: live.map((allocation) => allocation.amountPaymentCurrency),
  });
}

/**
 * The pieces every payment mutation shares: the lock plan, the reference and allocation checks, the receipt
 * claim and the persist → recompute → project → search → activity tail of the global write order (Q-BE3-1).
 * Valid only inside the use case's `Serializable` unit of work, after `lockPlan` took the row locks.
 */
export class PaymentSupport {
  constructor(
    readonly payments: PaymentRepository,
    readonly invoices: InvoiceRepository,
    private readonly references: PaymentReferencesPort,
    private readonly receipts: PaymentReceiptFilesPort,
    private readonly invoiceApi: PaymentInvoiceApi,
    private readonly recomputeInvoice: InvoiceRecomputer,
    private readonly projector: PaymentProjector,
    private readonly search: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly locks: RowLocksPort,
  ) {}

  nowIso(): string {
    return this.clock.now().toISOString();
  }

  // ───────────────────────────── Locks ─────────────────────────────

  /**
   * The rows a mutation may touch: the payment's own, its account and client, the invoices it is or will be
   * allocated to, and what those invoices feed (their installments and projects). Read before the unit of work.
   */
  async plan(args: PlanArgs): Promise<LockPlan> {
    const existing = args.paymentId ? await this.payments.findById(args.paymentId) : null;
    const allocations = args.paymentId ? await this.payments.liveAllocations(args.paymentId) : [];
    const invoiceIds = unique([
      ...(args.invoiceIds ?? []),
      ...allocations.map((allocation) => allocation.invoiceId),
    ]);
    const records: InvoiceRecord[] = [];
    for (const id of invoiceIds) {
      const record = await this.invoices.findById(id);
      if (record) records.push(record);
    }
    const installmentIds = unique(
      records.flatMap((record) => record.lines.map((line) => line.installmentId)),
    );
    const refs = installmentIds.length > 0 ? await this.invoices.installments(installmentIds) : [];
    return {
      args,
      paymentId: args.paymentId ?? null,
      clientIds: unique([
        ...(args.clientIds ?? []),
        existing?.clientId,
        ...records.map((record) => record.clientId),
      ]),
      accountIds: unique([...(args.accountIds ?? []), existing?.accountId]),
      invoiceIds,
      installmentIds,
      projectIds: unique([
        ...records.flatMap((record) => record.lines.map((line) => line.projectId)),
        ...refs.map((ref) => ref.projectId),
      ]),
    };
  }

  /**
   * Takes every lock of the plan in one call (the adapter orders them: Project, Client, BillingInstallment,
   * Invoice, Payment, Account), then re-reads the plan: a row set that grew meanwhile (a new allocation, an
   * invoice line moved to another project) is a `CONFLICT` the caller retries, so the lock set cannot be stale.
   */
  async lockPlan(plan: LockPlan): Promise<LockPlan> {
    const entries: Record<string, readonly string[]> = {
      Project: plan.projectIds,
      Client: plan.clientIds,
      BillingInstallment: plan.installmentIds,
      Invoice: plan.invoiceIds,
      Payment: plan.paymentId ? [plan.paymentId] : [],
      Account: plan.accountIds,
    };
    const set: RowLockSet = Object.fromEntries(
      Object.entries(entries).filter(([, ids]) => ids.length > 0),
    );
    await this.locks.lock(set);

    const fresh = await this.plan(plan.args);
    if (
      !isSubset(fresh.projectIds, plan.projectIds) ||
      !isSubset(fresh.clientIds, plan.clientIds) ||
      !isSubset(fresh.accountIds, plan.accountIds) ||
      !isSubset(fresh.installmentIds, plan.installmentIds) ||
      !isSubset(fresh.invoiceIds, plan.invoiceIds)
    ) {
      throw new ConflictError();
    }
    return fresh;
  }

  // ───────────────────────────── Reference rules ─────────────────────────────

  async requireClient(clientId: string) {
    const client = await this.references.liveClient(clientId);
    if (!client) throw new NotFoundError();
    return client;
  }

  /** A live account of the payment's currency; `mustBeActive` is asked when the payment moves to it. */
  async requireAccount(
    accountId: string,
    currency: string,
    mustBeActive: boolean,
  ): Promise<PaymentAccountRef> {
    const account = await this.references.account(accountId);
    if (!account) throw new NotFoundError();
    if (mustBeActive && !account.active) {
      throw new ValidationFailedError({
        fieldErrors: { accountId: [PAYMENT_ERRORS.accountInactive] },
      });
    }
    if (account.currency !== currency) {
      throw new ValidationFailedError({
        fieldErrors: { currency: [PAYMENT_ERRORS.currencyMismatch] },
      });
    }
    return account;
  }

  /** The active method; a payment without a reference is refused when the method asks for one (§8.6). */
  async requireMethod(methodId: string, reference: string | null): Promise<PaymentMethodRule> {
    const method = await this.references.activeMethod(methodId);
    if (!method) throw new NotFoundError();
    if (method.requiresReference && reference === null) {
      throw new ValidationFailedError({
        fieldErrors: { reference: [PAYMENT_MESSAGES.referenceRequired] },
      });
    }
    return method;
  }

  /** Claims the receipt (C23) and checks its type and size; an unknown or unusable one is `NOT_FOUND`/`VALIDATION`. */
  async reserveReceipt(actor: CurrentUser, fileId: string): Promise<void> {
    const file = await this.receipts.reserve(actor, fileId);
    const fail = (key: string) =>
      new ValidationFailedError({ fieldErrors: { receiptFileId: [key] } });
    if (!RECEIPT_MIME_TYPES.includes(file.mimeType)) {
      throw fail(PAYMENT_MESSAGES.fileTypeNotAllowed);
    }
    if (file.sizeBytes <= 0) throw fail(PAYMENT_MESSAGES.fileEmpty);
    if (file.sizeBytes > RECEIPT_MAX_BYTES) throw fail(PAYMENT_MESSAGES.fileTooLarge);
  }

  // ───────────────────────────── Allocation rules ─────────────────────────────

  /**
   * Validates allocations against the payment (HU-13 CA3): each invoice belongs to the client and is open, the
   * same-currency amounts match, the total stays within the allocatable amount and each amount within its
   * invoice balance. `existing` are the live allocations already stored, which count toward the total but never
   * toward an invoice balance. Reads the invoices after the locks, so the balance is the committed one (C18).
   */
  async checkAllocations(
    payment: { clientId: string; currency: string; allocatable: MoneyString },
    drafts: readonly AllocationInput[],
    existing: readonly PaymentAllocationRecord[],
  ): Promise<Map<string, InvoiceRecord>> {
    const errors: FieldErrors = {};
    const loaded = new Map<string, InvoiceRecord>();
    const checks: {
      draft: number;
      check: {
        amountPaymentCurrency: string;
        amountInvoiceCurrency: string;
        invoiceBalance: string;
      };
    }[] = [];
    for (const [index, draft] of drafts.entries()) {
      const invoice = await this.invoices.findById(draft.invoiceId);
      if (!invoice) throw new NotFoundError();
      loaded.set(invoice.id, invoice);
      if (invoice.clientId !== payment.clientId || !isOpenInvoice(invoice)) {
        addError(errors, `allocations.${index}.invoiceId`, PAYMENT_ERRORS.allocationInvoiceNotOpen);
        continue;
      }
      if (
        invoice.currency === payment.currency &&
        compareMoney(draft.amountInvoiceCurrency, draft.amountPaymentCurrency) !== 0
      ) {
        addError(
          errors,
          `allocations.${index}.amountInvoiceCurrency`,
          PAYMENT_ERRORS.allocationSameCurrency,
        );
      }
      checks.push({
        draft: index,
        check: {
          amountPaymentCurrency: draft.amountPaymentCurrency,
          amountInvoiceCurrency: draft.amountInvoiceCurrency,
          invoiceBalance: invoice.balance,
        },
      });
    }
    if (Object.keys(errors).length === 0) {
      // The stored allocations go first as one row (index 0): they count toward the allocatable total, which
      // allocationProblems sums together with the drafts, but never toward an invoice balance.
      const existingTotal = sumMoney(existing.map((row) => row.amountPaymentCurrency));
      const problems = allocationProblems(payment.allocatable, [
        { amountPaymentCurrency: existingTotal, amountInvoiceCurrency: '0', invoiceBalance: '0' },
        ...checks.map((item) => item.check),
      ]);
      for (const problem of problems) {
        if (problem.kind === 'exceedsAllocatable') {
          addError(errors, 'allocations', PAYMENT_MESSAGES.allocationsExceedAllocatable);
          continue;
        }
        const item = checks[problem.index - 1];
        if (item) {
          addError(
            errors,
            `allocations.${item.draft}.amountInvoiceCurrency`,
            PAYMENT_ERRORS.allocationExceedsBalance,
          );
        }
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
    return loaded;
  }

  /** The allocation row for a draft: the USD snapshot is taken once at the payment rate (§9.5, C16). */
  allocationRecord(
    payment: PaymentRecord,
    draft: AllocationInput,
    id: string,
    actorId: string,
  ): PaymentAllocationRecord {
    const amountPaymentCurrency = roundMoney(draft.amountPaymentCurrency);
    return {
      id,
      paymentId: payment.id,
      invoiceId: draft.invoiceId,
      amountPaymentCurrency,
      amountInvoiceCurrency: roundMoney(draft.amountInvoiceCurrency),
      amountUsd: toUsd(amountPaymentCurrency, payment.usdRate),
      createdAt: this.nowIso(),
      createdById: actorId,
      deletedAt: null,
    };
  }

  // ───────────────────────────── Tail of every mutation ─────────────────────────────

  async output(id: string): Promise<PaymentOutput> {
    const view = await this.payments.view(id);
    if (!view) throw new NotFoundError();
    return view;
  }

  /**
   * Recomputes what the written payment feeds, in the documented order: the invoices whose allocations changed
   * (cached totals, status, installments), the payment facts, the balance of its accounts, the metrics of its
   * clients and then of the projects of the touched invoices, the search entries and the activity entry.
   * `before` is the stored row the write started from (`null` for an insert).
   */
  async settle(args: {
    readonly actor: Actor;
    readonly action: ActivityAction;
    readonly before: PaymentRecord | null;
    readonly after: PaymentRecord;
    readonly invoiceIds: readonly string[];
    readonly changes?: Record<string, unknown> | null;
    readonly metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { before, after } = args;
    const touched: InvoiceRecord[] = [];
    for (const id of unique(args.invoiceIds).sort()) {
      touched.push(await this.recomputeInvoice.execute(id));
    }
    await this.projector.projectPayment(after.id);
    for (const accountId of unique([before?.accountId, after.accountId])) {
      await this.projector.projectAccount(accountId);
    }
    await this.projector.projectClients(unique([before?.clientId, after.clientId]));
    const projectIds = unique(touched.flatMap((invoice) => invoice.lines.map((l) => l.projectId)));
    if (projectIds.length > 0) await this.projector.projectProjects(projectIds);

    for (const invoice of touched) await this.invoiceApi.reindex(invoice);
    await this.reindex(after);
    await this.activityLog.record({
      actor: args.actor,
      action: args.action,
      entityType: 'PAYMENT',
      entityId: after.id,
      entityLabel: after.code,
      clientId: after.clientId,
      touchClientIds: unique([before?.clientId, after.clientId]),
      ...(args.changes ? { changes: args.changes } : {}),
      metadata: { code: after.code, ...args.metadata },
    });
  }

  /** Writes the search entry of the payment. */
  async reindex(after: PaymentRecord): Promise<void> {
    const view = await this.payments.view(after.id);
    await this.search.upsert({
      entityType: 'PAYMENT',
      entityId: after.id,
      code: after.code,
      title: after.reference ?? after.code,
      subtitle: view?.client.label ?? null,
      body: [after.reference, view?.method.name].filter(Boolean).join(' ') || null,
      status: after.status,
      archived: false,
    });
  }
}
