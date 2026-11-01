import type { Actor } from '../../../shared/application/actor';
import type { ActivityLogPort } from '../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas } from '../../../shared/domain/business-date';
import { ForbiddenError } from '../../../shared/domain/domain-error';
import {
  percentOf,
  subMoney,
  toDecimal,
  toUsd,
  type MoneyString,
} from '../../../shared/domain/money';
import { computeInstallmentStatus } from '../domain/installments';
import {
  IVA_ADJUSTMENT_LIMIT,
  computeInvoiceTotals,
  computeLineAmounts,
} from '../domain/invoice-totals';
import { computeInvoiceBalance, computeInvoiceStatus } from '../domain/invoice-status';
import { computePaymentAmounts } from '../domain/payments';
import { normalizeToMonth } from '../domain/recurring';
import type { FinanceProjector } from './finance-projector';
import type { FinanceSourcesPort, InvoiceCacheSource } from './ports/finance-sources.port';
import type { InvoiceCacheWrite, ReadModelWriterPort } from './ports/read-model-writer.port';

export { SYSTEM_ACTOR } from '../../../shared/application/actor';

/** The transaction budget of the rebuild; see `RecomputeAll`. */
export const RECOMPUTE_ALL_TIMEOUT_MS = 1_800_000;

export type RecomputeProblem = { entity: string; id: string; reason: string };

export type RecomputeAllResult = {
  counts: Record<string, number>;
  /** Rows whose stored data cannot be recomputed (a RangeError of the domain); they keep their cache. */
  problems: RecomputeProblem[];
};

/** The adjustment a stored tax line carries: `ivaAmount − round(taxBase × rate / 100, 2)` (DT-44). */
function storedAdjustment(line: InvoiceCacheSource['taxLines'][number]): MoneyString {
  return subMoney(line.ivaAmount, percentOf(line.taxBase, line.ivaRate));
}

function sameDecimal(a: MoneyString, b: MoneyString): boolean {
  return toDecimal(a).equals(toDecimal(b));
}

/** Totals and cache of one invoice; throws `RangeError` when its data breaks a domain rule. */
function rebuildInvoice(source: InvoiceCacheSource, today: string): InvoiceCacheWrite {
  const base = {
    lines: source.lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRate: line.ivaRate,
    })),
    ivaWithheld: source.ivaWithheld,
    islrWithheld: source.islrWithheld,
    otherWithheld: source.otherWithheld,
    usdRate: source.usdRate,
  };
  // First pass without adjustments gives the current taxBase of each rate; a stored adjustment survives
  // only where its taxBase and rate are unchanged and it is still within ±0.01 (data-rules §8).
  const plain = computeInvoiceTotals({ ...base, taxAdjustments: [] });
  const taxAdjustments = source.taxLines.flatMap((stored) => {
    const current = plain.taxLines.find((line) => sameDecimal(line.ivaRate, stored.ivaRate));
    if (!current || !sameDecimal(current.taxBase, stored.taxBase)) return [];
    const adjustment = storedAdjustment(stored);
    if (toDecimal(adjustment).isZero()) return [];
    if (toDecimal(adjustment).abs().greaterThan(IVA_ADJUSTMENT_LIMIT)) return [];
    return [{ ivaRate: stored.ivaRate, adjustment }];
  });
  const totals =
    taxAdjustments.length > 0 ? computeInvoiceTotals({ ...base, taxAdjustments }) : plain;
  const { paidAmount, balance } = computeInvoiceBalance(
    totals.receivable,
    source.allocations.map((allocation) => ({
      amountInvoiceCurrency: allocation.amountInvoiceCurrency,
      paymentStatus: allocation.paymentStatus,
      voided: false,
    })),
  );
  return {
    lines: source.lines.map((line) => {
      const { amount, netAmount } = computeLineAmounts(line);
      return { id: line.id, amount, netAmount };
    }),
    subtotal: totals.subtotal,
    discount: totals.discount,
    exemptAmount: totals.exemptAmount,
    taxBase: totals.taxBase,
    ivaAmount: totals.ivaAmount,
    total: totals.total,
    receivable: totals.receivable,
    totalUsd: totals.totalUsd,
    receivableUsd: totals.receivableUsd,
    paidAmount,
    balance,
    status: computeInvoiceStatus(
      {
        voided: source.voided,
        draft: source.isDraft,
        dueDate: source.dueDate,
        receivable: totals.receivable,
        paidAmount,
      },
      today,
    ),
    taxLines: totals.taxLines.map((line) => ({
      ivaRate: line.ivaRate,
      taxBase: line.taxBase,
      ivaAmount: line.ivaAmount,
    })),
  };
}

/**
 * Rebuilds every cache and read model from the sources, through the same domain functions the
 * mutations use (C17; data-rules §8, `scripts/recompute-all.ts`). Runs as the `SYSTEM` actor in one
 * `Serializable` unit of work holding every row lock in the global order. It reads no `ExchangeRate`:
 * every USD amount comes from the snapshot rate stored with its row (C16). Rows whose data breaks a
 * domain rule are reported in `problems` and keep their cache; the rest is rebuilt.
 *
 * Order: invoice caches, payment caches, installment statuses, recurring snapshots, then the facts
 * (cleared and re-projected), `Account.balance`, `ClientMetrics` and `ProjectMetrics`, each ascending.
 */
export class RecomputeAll {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly sources: FinanceSourcesPort,
    private readonly writer: ReadModelWriterPort,
    private readonly projector: FinanceProjector,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor): Promise<RecomputeAllResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    return this.uow.run(() => this.rebuild(actor), {
      isolation: 'Serializable',
      timeoutMs: RECOMPUTE_ALL_TIMEOUT_MS,
    });
  }

  private async rebuild(actor: Actor): Promise<RecomputeAllResult> {
    const ids = await this.sources.allIds();
    await this.locks.lock({
      Project: ids.projects,
      Client: ids.clients,
      RecurringCharge: ids.recurringCharges,
      RecurringExpense: ids.recurringExpenses,
      BillingInstallment: ids.installments,
      Invoice: ids.invoices,
      Payment: ids.payments,
      Expense: ids.expenses,
      Account: ids.accounts,
    });
    const problems: RecomputeProblem[] = [];
    const today = todayInCaracas(this.clock.now());

    for (const id of ids.invoices) {
      const source = await this.sources.invoiceCache(id);
      if (!source) continue;
      try {
        await this.writer.writeInvoiceCache(id, rebuildInvoice(source, today));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        problems.push({ entity: 'INVOICE', id, reason: error.message });
      }
    }
    for (const id of ids.payments) {
      const source = await this.sources.paymentCache(id);
      if (!source) continue;
      const { allocatable, netCredited, unallocated } = computePaymentAmounts({
        amount: source.amount,
        igtfAmount: source.igtfAmount,
        feeAmount: source.feeAmount,
        allocated: source.allocated,
      });
      await this.writer.writePaymentCache(id, { allocatable, netCredited, unallocated });
    }
    // After the invoices: the status of an installment reads the invoice caches written above.
    for (const id of ids.installments) {
      const source = await this.sources.installmentCache(id);
      if (!source) continue;
      await this.writer.writeInstallmentStatus(
        id,
        computeInstallmentStatus({ cancelled: source.cancelled, invoices: source.invoices }),
      );
    }
    for (const id of ids.recurringCharges) {
      const source = await this.sources.recurringChargeCache(id);
      if (source) await this.writer.writeRecurringChargeMonthlyUsd(id, monthlyUsd(source));
    }
    for (const id of ids.recurringExpenses) {
      const source = await this.sources.recurringExpenseCache(id);
      if (source) await this.writer.writeRecurringExpenseMonthlyUsd(id, monthlyUsd(source));
    }

    await this.writer.clearFacts();
    for (const id of ids.invoices) await this.projector.projectInvoice(id);
    for (const id of ids.payments) await this.projector.projectPayment(id);
    for (const id of ids.expenses) await this.projector.projectExpense(id);
    for (const id of ids.transfers) await this.projector.projectTransfer(id);
    for (const id of ids.movements) await this.projector.projectMovement(id);
    for (const id of ids.accounts) await this.projector.projectAccount(id);
    await this.projector.projectClients(ids.clients);
    await this.projector.projectProjects(ids.projects);

    const counts = Object.fromEntries(
      Object.entries(ids).map(([name, list]) => [name, list.length]),
    );
    await this.activity.record({
      actor,
      action: 'SYSTEM_JOB',
      entityType: 'SETTING',
      entityId: 'recompute-all',
      entityLabel: 'recompute-all',
      metadata: { ...counts, problems: problems.length },
    });
    return { counts, problems };
  }
}

/** Monthly equivalent in USD at the snapshot rate: normalize to a month, then convert (`projects.ts`). */
function monthlyUsd(source: {
  amount: MoneyString;
  frequency: Parameters<typeof normalizeToMonth>[1];
  usdRate: MoneyString;
}): MoneyString {
  return toUsd(normalizeToMonth(source.amount, source.frequency), source.usdRate);
}
