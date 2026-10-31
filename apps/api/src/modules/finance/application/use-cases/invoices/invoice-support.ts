import type { Actor } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type {
  RowLockSet,
  RowLocksPort,
} from '../../../../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import {
  daysBetween,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { ActivityAction } from '../../../../../shared/domain/enums';
import {
  compareMoney,
  roundMoney,
  subMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { INVOICE_ERRORS } from '../../../domain/errors';
import { computeLineAmounts } from '../../../domain/invoice-totals';
import type { FinanceProjector } from '../../finance-projector';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type {
  InvoiceFilesPort,
  InvoiceFiscalPort,
  InvoiceReferencesPort,
} from '../../ports/invoice-references.port';
import type {
  InvoiceLineRecord,
  InvoiceListRowView,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceView,
} from '../../ports/invoice.repository.port';
import {
  adjustmentOf,
  carriedAdjustments,
  deriveColumns,
  totalsOrInvalid,
} from './invoice-calculator';
import {
  INVOICE_MESSAGES,
  invalid,
  invoiceInputErrors,
  normalizeInvoiceInput,
  throwIfAny,
  type InvoiceInput,
  type NormalizedInvoiceInput,
} from './invoice-input';

/** MIME types and size of an invoice file (HU-14 CA1: PDF, PNG, JPG or WEBP up to 10 MB, DT-41). */
export const INVOICE_FILE_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];
export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const INVOICE_SORT_FIELDS = [
  'code',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'total',
  'totalUsd',
  'balance',
  'balanceUsd',
  'status',
  'daysOverdue',
] as const;

/** Fields the `UPDATE` entry compares; `total` is what HU-29 CA1 requires. */
export const INVOICE_ACTIVITY_FIELDS = [
  'clientId',
  'invoiceNumber',
  'controlNumber',
  'issueDate',
  'dueDate',
  'currency',
  'usdRate',
  'bcvRate',
  'total',
  'ivaWithheld',
  'islrWithheld',
  'otherWithheld',
  'isDraft',
  'fileId',
] as const;

/** An invoice as the routes return it: stored columns plus the derived `adjustment`, `daysOverdue` and flags. */
export interface InvoiceOutput extends Omit<InvoiceView, 'taxLines'> {
  readonly taxLines: readonly {
    readonly ivaRate: MoneyString;
    readonly taxBase: MoneyString;
    readonly ivaAmount: MoneyString;
    readonly adjustment: MoneyString;
  }[];
  /** Balance in USD at the invoice's own rate (C16). */
  readonly balanceUsd: MoneyString;
  readonly daysOverdue: number;
  /** A payment was applied and the invoice is not fully paid yet. */
  readonly hasPartialPayment: boolean;
}

export interface InvoiceListRowOutput extends InvoiceListRowView {
  readonly daysOverdue: number;
  readonly hasPartialPayment: boolean;
}

function daysOverdueOf(status: string, dueDate: DateOnly, today: DateOnly): number {
  return status === 'VENCIDA' ? Math.max(0, daysBetween(dueDate, today)) : 0;
}

function hasPartialPaymentOf(status: string, paidAmount: MoneyString): boolean {
  return status !== 'PAGADA' && compareMoney(paidAmount, '0') > 0;
}

export function toInvoiceOutput(view: InvoiceView, today: DateOnly): InvoiceOutput {
  return {
    ...view,
    taxLines: view.taxLines.map((line) => ({ ...line, adjustment: adjustmentOf(line) })),
    balanceUsd: toUsd(view.balance, view.usdRate),
    daysOverdue: daysOverdueOf(view.status, view.dueDate, today),
    hasPartialPayment: hasPartialPaymentOf(view.status, view.paidAmount),
  };
}

export function toInvoiceRowOutput(row: InvoiceListRowView, today: DateOnly): InvoiceListRowOutput {
  return {
    ...row,
    daysOverdue: daysOverdueOf(row.status, row.dueDate, today),
    hasPartialPayment: hasPartialPaymentOf(row.status, row.paidAmount),
  };
}

export function todayOf(clock: ClockPort): DateOnly {
  return todayInCaracas(clock.now());
}

const unique = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === 'string')),
];

/** What a mutation may touch, read before the unit of work to know which rows to lock. */
export interface PlanArgs {
  readonly invoiceId?: string | null;
  readonly clientIds?: readonly (string | null | undefined)[];
  readonly projectIds?: readonly (string | null | undefined)[];
  readonly installmentIds?: readonly (string | null | undefined)[];
}

export interface LockPlan {
  readonly args: PlanArgs;
  readonly invoiceId: string | null;
  readonly clientIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly installmentIds: readonly string[];
  /** Payments allocated to the invoice: their facts depend on its lines. */
  readonly paymentIds: readonly string[];
}

/** The part of the projector an invoice mutation uses. */
export type InvoiceProjector = Pick<
  FinanceProjector,
  'projectInvoice' | 'projectPayment' | 'projectClients' | 'projectProjects'
>;

/** `RecomputeInstallmentStatus` as the invoices see it (billing exports it; it never locks). */
export interface InstallmentStatusRecomputer {
  execute(installmentIds: readonly string[]): Promise<unknown>;
}

const isSubset = (inner: readonly string[], outer: readonly string[]): boolean =>
  inner.every((id) => outer.includes(id));

/**
 * The pieces every invoice mutation shares: the lock plan, the reference checks, the line rules, the file claim
 * and the persist → recompute → project → search → activity tail of the global write order (Q-BE3-1). Valid only
 * inside the use case's `Serializable` unit of work, after `lockPlan` took the row locks.
 */
export class InvoiceSupport {
  constructor(
    readonly invoices: InvoiceRepository,
    private readonly references: InvoiceReferencesPort,
    private readonly fiscal: InvoiceFiscalPort,
    private readonly files: InvoiceFilesPort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly projector: InvoiceProjector,
    private readonly installments: InstallmentStatusRecomputer,
    private readonly search: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly locks: RowLocksPort,
  ) {}

  today(): DateOnly {
    return todayOf(this.clock);
  }

  nowIso(): string {
    return this.clock.now().toISOString();
  }

  // ───────────────────────────── Input ─────────────────────────────

  /** Checks the shape of the input (and its currency) and returns it normalized. Throws `VALIDATION`. */
  async prepare(input: InvoiceInput): Promise<NormalizedInvoiceInput> {
    throwIfAny(invoiceInputErrors(input, await this.fiscal.allowedIvaRates()));
    const known = await this.currencies.knownCodes([input.currency]);
    if (!known.has(input.currency)) {
      throw invalid('currency', INVOICE_MESSAGES.unknownCurrency);
    }
    return normalizeInvoiceInput(input);
  }

  // ───────────────────────────── Locks ─────────────────────────────

  /**
   * The rows a mutation may touch: the invoice's own and the ones the input names. Read before the unit of
   * work (the installments' projects and the allocated payments are only learned from the database).
   */
  async plan(args: PlanArgs): Promise<LockPlan> {
    const existing = args.invoiceId ? await this.invoices.findById(args.invoiceId) : null;
    const installmentIds = unique([
      ...(args.installmentIds ?? []),
      ...(existing?.lines.map((line) => line.installmentId) ?? []),
    ]);
    const refs = await this.invoices.installments(installmentIds);
    const allocations = args.invoiceId ? await this.invoices.liveAllocations(args.invoiceId) : [];
    return {
      args,
      invoiceId: args.invoiceId ?? null,
      clientIds: unique([...(args.clientIds ?? []), existing?.clientId]),
      projectIds: unique([
        ...(args.projectIds ?? []),
        ...(existing?.lines.map((line) => line.projectId) ?? []),
        ...refs.map((ref) => ref.projectId),
      ]),
      installmentIds,
      paymentIds: unique(allocations.map((allocation) => allocation.paymentId)),
    };
  }

  /**
   * Takes every lock of the plan in one call, then re-reads the plan: a row set that grew meanwhile (another
   * project on the invoice, a new allocation, an installment moved) is a `CONFLICT` the caller retries, so the
   * lock set can never be out of date.
   */
  async lockPlan(plan: LockPlan): Promise<LockPlan> {
    const entries: Record<string, readonly string[]> = {
      Project: plan.projectIds,
      Client: plan.clientIds,
      BillingInstallment: plan.installmentIds,
      Invoice: plan.invoiceId ? [plan.invoiceId] : [],
      Payment: plan.paymentIds,
    };
    // Only the classes that have rows: the adapter orders them in the global lock order.
    const set: RowLockSet = Object.fromEntries(
      Object.entries(entries).filter(([, ids]) => ids.length > 0),
    );
    await this.locks.lock(set);

    const fresh = await this.plan(plan.args);
    if (
      !isSubset(fresh.projectIds, plan.projectIds) ||
      !isSubset(fresh.clientIds, plan.clientIds) ||
      !isSubset(fresh.installmentIds, plan.installmentIds) ||
      !isSubset(fresh.paymentIds, plan.paymentIds)
    ) {
      throw new ConflictError();
    }
    return fresh;
  }

  /** Locks only the invoice row (the file attach touches nothing else). */
  async lockInvoice(id: string): Promise<void> {
    await this.locks.lock({ Invoice: [id] });
  }

  // ───────────────────────────── Reference rules ─────────────────────────────

  liveClientRef(clientId: string) {
    return this.references.liveClient(clientId);
  }

  async requireClient(clientId: string) {
    const client = await this.liveClientRef(clientId);
    if (!client) throw new NotFoundError();
    return client;
  }

  async assertNumberFree(invoiceNumber: string, selfId: string | null): Promise<void> {
    const holder = await this.invoices.numberHolder(invoiceNumber, selfId);
    if (!holder) return;
    throw new ConflictError({
      message: INVOICE_ERRORS.numberTaken,
      fieldErrors: { invoiceNumber: [INVOICE_ERRORS.numberTaken] },
      entity: { type: 'INVOICE', id: holder.id, code: holder.code, label: holder.invoiceNumber },
    });
  }

  /**
   * Resolves the lines: a project must be live and belong to the client; an installment must be live, of the
   * same currency, of a project of the client, and not over-billed by the other live invoices (HU-11 CA1, CA5).
   * A line keeps its id only when it already belongs to this invoice (C14).
   */
  async resolveLines(
    clientId: string,
    input: NormalizedInvoiceInput,
    selfId: string | null,
    previous: readonly InvoiceLineRecord[],
    ids: IdGeneratorPort,
  ): Promise<InvoiceLineRecord[]> {
    const installmentIds = unique(input.lines.map((line) => line.installmentId));
    const refs = new Map((await this.invoices.installments(installmentIds)).map((r) => [r.id, r]));
    const billed = await this.invoices.billedAmounts(installmentIds, selfId);
    const usedIds = new Set<string>();
    const resolved: InvoiceLineRecord[] = [];

    for (const [index, line] of input.lines.entries()) {
      const at = (field: string) => `lines.${index}.${field}`;
      let amounts: { amount: MoneyString; netAmount: MoneyString };
      try {
        amounts = computeLineAmounts(line);
      } catch (error) {
        if (error instanceof RangeError) {
          throw invalid(at('discount'), INVOICE_MESSAGES.discountExceedsAmount);
        }
        throw error;
      }

      let installmentProject: string | null = null;
      if (line.installmentId) {
        const ref = refs.get(line.installmentId);
        if (!ref) throw new NotFoundError();
        if (!(await this.references.projectBelongsToClient(ref.projectId, clientId))) {
          throw invalid(at('installmentId'), INVOICE_ERRORS.projectOtherClient);
        }
        if (ref.cancelled) throw invalid(at('installmentId'), INVOICE_ERRORS.installmentCancelled);
        if (ref.currency !== input.currency) {
          throw invalid(at('installmentId'), INVOICE_ERRORS.installmentCurrency);
        }
        const taken = billed.get(ref.id) ?? '0.00';
        const remaining =
          compareMoney(ref.amount, taken) > 0 ? subMoney(ref.amount, taken) : '0.00';
        if (compareMoney(amounts.netAmount, remaining) > 0) {
          throw invalid(at('unitPrice'), INVOICE_ERRORS.installmentExceeded);
        }
        installmentProject = ref.projectId;
      }

      if (line.projectId) {
        if (!(await this.references.liveProject(line.projectId))) throw new NotFoundError();
        if (!(await this.references.projectBelongsToClient(line.projectId, clientId))) {
          throw invalid(at('projectId'), INVOICE_ERRORS.projectOtherClient);
        }
      }

      const keepsId =
        line.id !== undefined && !usedIds.has(line.id) && previous.some((p) => p.id === line.id);
      const id = keepsId ? (line.id as string) : ids.next();
      usedIds.add(id);
      resolved.push({
        id,
        order: index,
        description: line.description,
        projectId: line.projectId ?? installmentProject,
        installmentId: line.installmentId,
        quantity: roundMoney(line.quantity),
        unitPrice: line.unitPrice,
        amount: amounts.amount,
        discount: line.discount,
        netAmount: amounts.netAmount,
        ivaRate: line.ivaRate,
      });
    }
    return resolved;
  }

  /** The C17 totals of the normalized input for the resolved lines. */
  derive(
    input: NormalizedInvoiceInput,
    lines: readonly InvoiceLineRecord[],
    allocations: Parameters<typeof deriveColumns>[2],
    state: { voided: boolean },
  ) {
    const totals = totalsOrInvalid({
      lines: lines.map((line) => ({
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
    return {
      totals,
      columns: deriveColumns(
        totals,
        { voided: state.voided, draft: input.isDraft, dueDate: input.dueDate },
        allocations,
        this.today(),
      ),
    };
  }

  /**
   * The derived columns of a stored invoice from its lines and its live allocations, keeping the valid manual
   * adjustments (`data-rules.md` §8). Nothing is written.
   */
  async rederive(record: InvoiceRecord): Promise<InvoiceRecord> {
    const lines = record.lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRate: line.ivaRate,
    }));
    const totals = totalsOrInvalid({
      lines,
      taxAdjustments: carriedAdjustments(record.taxLines, lines),
      ivaWithheld: record.ivaWithheld,
      islrWithheld: record.islrWithheld,
      otherWithheld: record.otherWithheld,
      usdRate: record.usdRate,
    });
    const columns = deriveColumns(
      totals,
      { voided: record.voidedAt !== null, draft: record.isDraft, dueDate: record.dueDate },
      await this.invoices.liveAllocations(record.id),
      this.today(),
    );
    return { ...record, ...columns };
  }

  // ───────────────────────────── Files ─────────────────────────────

  /** Claims the file (C23) and checks its type and size; an unknown or unusable one is `VALIDATION` on `fileId`. */
  async reserveFile(actor: CurrentUser, fileId: string): Promise<void> {
    let file;
    try {
      file = await this.files.reserve(actor, fileId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw invalid('fileId', INVOICE_ERRORS.fileNotReady);
      }
      throw error;
    }
    if (!INVOICE_FILE_MIME_TYPES.includes(file.mimeType)) {
      throw invalid('fileId', INVOICE_ERRORS.fileType);
    }
    if (file.sizeBytes > INVOICE_FILE_MAX_BYTES) {
      throw invalid('fileId', INVOICE_ERRORS.fileTooLarge);
    }
  }

  // ───────────────────────────── Tail of every mutation ─────────────────────────────

  /** Refreshes the stored status of the installments the invoice bills (billing owns the rule). */
  async recomputeInstallments(installmentIds: readonly string[]): Promise<void> {
    await this.installments.execute(installmentIds);
  }

  async output(id: string): Promise<InvoiceOutput> {
    const view = await this.invoices.view(id);
    if (!view) throw new NotFoundError();
    return toInvoiceOutput(view, this.today());
  }

  /**
   * Recomputes what the written invoice feeds, in the documented order: the installments' status, the invoice
   * facts, the facts of the payments allocated to it, the metrics of its clients and then of its projects.
   * `before` is the stored row the write started from (`null` for an insert).
   */
  async project(
    before: InvoiceRecord | null,
    after: InvoiceRecord,
    paymentIds: readonly string[] = [],
  ): Promise<void> {
    const installmentIds = unique(
      [...(before?.lines ?? []), ...after.lines].map((line) => line.installmentId),
    );
    if (installmentIds.length > 0) await this.recomputeInstallments(installmentIds);
    await this.projector.projectInvoice(after.id);
    for (const paymentId of paymentIds) await this.projector.projectPayment(paymentId);
    await this.projector.projectClients(unique([before?.clientId, after.clientId]));
    const projectIds = unique(
      [...(before?.lines ?? []), ...after.lines].map((line) => line.projectId),
    );
    if (projectIds.length > 0) await this.projector.projectProjects(projectIds);
  }

  /** The search entry and the activity entry, the last writes of the unit of work. */
  async record(
    actor: Actor,
    action: ActivityAction,
    before: InvoiceRecord | null,
    after: InvoiceRecord,
    detail: { changes?: Record<string, unknown> | null; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.reindex(after);
    await this.logOnly(actor, action, after, detail, before?.clientId);
  }

  /** Writes the search entry. Exported for payments: a recompute changes the status it shows. */
  async reindex(after: InvoiceRecord): Promise<void> {
    const view = await this.invoices.view(after.id);
    await this.search.upsert({
      entityType: 'INVOICE',
      entityId: after.id,
      code: after.code,
      title: after.invoiceNumber,
      subtitle: view?.client.label ?? null,
      body: after.lines.map((line) => line.description).join(' '),
      status: after.status,
      archived: after.archivedAt !== null,
    });
  }

  /** The activity entry alone, for a change that neither feeds a read model nor shows in the search. */
  async logOnly(
    actor: Actor,
    action: ActivityAction,
    after: InvoiceRecord,
    detail: { changes?: Record<string, unknown> | null; metadata?: Record<string, unknown> } = {},
    previousClientId?: string | null,
  ): Promise<void> {
    await this.activityLog.record({
      actor,
      action,
      entityType: 'INVOICE',
      entityId: after.id,
      entityLabel: after.invoiceNumber,
      clientId: after.clientId,
      touchClientIds: unique([previousClientId, after.clientId]),
      ...(detail.changes ? { changes: detail.changes } : {}),
      metadata: { code: after.code, ...detail.metadata },
    });
  }
}
