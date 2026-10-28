// MOCK — dashboard of Hito 1 (PRD §8.1, A1). `fn(ctx, input)`, framework-free (C11). Every figure is USD
// summed from the snapshots stored on each record (C16): never converted with today's rate. The one
// exception is §8.1's own "Saldo total en cuentas", the accounts' `balanceUsd` at their latest rate.
// Replaced by `src/server/services/dashboard.service.ts` in Hito 2 (C9).
//
// Definitions (the month is a Caracas calendar month; its "close" is its last day, or today while current):
//   collected        confirmed payments dated in the month (`amountUsd`).
//   billed           issued invoices (not draft, void or archived) with `issueDate` in the month (`totalUsd`).
//   receivable       at the close: each issued invoice's receivable minus the confirmed allocations dated up to
//                    then, in USD at the invoice's own rate; the overdue part is the share past its due date.
//   expenses         paid expenses with `paidAt` (else `date`) in the month; result = collected − expenses.
//   MRR              `computeMrr` over the charges active at the close, USD at the plan's snapshot rate.
//   active projects  `EN_CURSO` and `MANTENIMIENTO`, not archived.
// The previous period is the previous month at its own close. There is no balance or status history in the
// store, so "accounts balance" and "active projects" carry no comparison (`previousValue: null`).
// Members and Viewers get the dashboard without financial data (PRD §11): the financial cards are zero with
// no comparison and the financial panels are empty; the activity log needs `read` on `activity`.
import { addDays, daysBetween, todayInCaracas, type DateOnly } from "@/lib/dates";
import { computeMrr, type KpiRecurringItem } from "@/lib/finance";
import {
  compareMoney,
  roundMoney,
  subMoney,
  sumMoney,
  toDecimal,
  toUsd,
  type MoneyString,
} from "@/lib/money";
import type { EntityRef } from "@/lib/validators/common";
import {
  DASHBOARD_KPI_ID_VALUES,
  DASHBOARD_KPI_UNITS,
  type DashboardActivityRow,
  type DashboardDTO,
  type DashboardDocumentRow,
  type DashboardInstallmentRow,
  type DashboardInvoiceRow,
  type DashboardKpiId,
  type DashboardQuery,
  type DashboardRecurringExpenseRow,
  type KpiCardDTO,
  type MonthKey,
} from "@/lib/validators/dashboard";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import { can, canSeeFinancials } from "@/server/auth/permissions";
import type { MockServiceContext } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import type { MockStore } from "../store";

const ZERO = "0.00";
const WINDOW_DAYS = 30;
const CHART_MONTHS = 12;
const TOP_INVOICES = 5;
const RECENT_EVENTS = 15;
const OPEN_INVOICE_STATUSES = new Set(["EMITIDA", "PARCIAL", "VENCIDA"]);
const ACTIVE_PROJECT_STATUSES = new Set(["EN_CURSO", "MANTENIMIENTO"]);

// ───────────────────────────── Months ─────────────────────────────

function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

const monthStart = (month: MonthKey): DateOnly => `${month}-01`;
const monthEnd = (month: MonthKey): DateOnly => addDays(monthStart(shiftMonth(month, 1)), -1);
const inRange = (date: DateOnly | null, from: DateOnly, to: DateOnly) =>
  date !== null && date >= from && date <= to;

/** The month's close: its last day, or today while it is still running. */
const closeOf = (month: MonthKey, today: DateOnly): DateOnly =>
  monthEnd(month) < today ? monthEnd(month) : today;

// ───────────────────────────── Aggregates ─────────────────────────────

function collectedUsd(db: MockStore, from: DateOnly, to: DateOnly): MoneyString {
  return sumMoney(
    db.payments
      .filter((row) => row.status === "CONFIRMADO" && inRange(row.date, from, to))
      .map((row) => row.amountUsd),
  );
}

/** Invoices that count as billed: issued, not void, not archived. */
const isIssued = (row: InvoiceDetailDTO) =>
  !row.isDraft && row.status !== "BORRADOR" && row.status !== "ANULADA" && !row.archivedAt;

function billedUsd(db: MockStore, from: DateOnly, to: DateOnly): MoneyString {
  return sumMoney(
    db.invoices
      .filter((row) => isIssued(row) && inRange(row.issueDate, from, to))
      .map((row) => row.totals.totalUsd),
  );
}

function paidExpensesUsd(db: MockStore, from: DateOnly, to: DateOnly): MoneyString {
  return sumMoney(
    db.expenses
      .filter((row) => row.status === "PAGADO" && inRange(row.paidAt ?? row.date, from, to))
      .map((row) => row.amountUsd),
  );
}

/** Receivable and its overdue part at the end of `asOf`, in USD at each invoice's own rate. */
function receivableAt(db: MockStore, asOf: DateOnly): { total: MoneyString; overdue: MoneyString } {
  const confirmedOn = new Map(
    db.payments.filter((row) => row.status === "CONFIRMADO").map((row) => [row.id, row.date]),
  );
  const totals: MoneyString[] = [];
  const overdue: MoneyString[] = [];
  for (const invoice of db.invoices) {
    if (!isIssued(invoice) || invoice.issueDate > asOf) continue;
    const applied = db.paymentAllocations
      .filter((row) => row.invoice.id === invoice.id)
      .filter((row) => {
        const date = confirmedOn.get(row.paymentId);
        return date !== undefined && date <= asOf;
      })
      .map((row) => row.amountInvoiceCurrency);
    const balance = subMoney(invoice.totals.receivable, sumMoney(applied));
    if (compareMoney(balance, ZERO) <= 0) continue;
    const balanceUsd = toUsd(balance, invoice.usdRate);
    totals.push(balanceUsd);
    if (invoice.dueDate < asOf) overdue.push(balanceUsd);
  }
  return { total: sumMoney(totals), overdue: sumMoney(overdue) };
}

/** MRR at `asOf`: active charges started by then and not ended, in USD at the plan's snapshot rate. */
function mrrAt(db: MockStore, asOf: DateOnly): MoneyString {
  const items: KpiRecurringItem[] = [];
  for (const charge of db.recurringCharges) {
    if (charge.startDate > asOf || (charge.endDate !== null && charge.endDate < asOf)) continue;
    const plan = db.billingPlans.find((row) => row.projectId === charge.projectId);
    let amountUsd: MoneyString | null = null;
    if (charge.currency === "USD") amountUsd = charge.amount;
    else if (plan?.currency === charge.currency && plan.usdRate !== null) {
      amountUsd = toUsd(charge.amount, plan.usdRate);
    }
    if (amountUsd !== null) {
      items.push({ amountUsd, frequency: charge.frequency, status: charge.status });
    }
  }
  return computeMrr(items);
}

/** Change vs the previous value in percent; `null` when the previous value is missing or zero. */
function changePercent(value: MoneyString, previous: MoneyString | null): MoneyString | null {
  if (previous === null || toDecimal(previous).isZero()) return null;
  const delta = toDecimal(value).minus(toDecimal(previous));
  return roundMoney(delta.times(100).dividedBy(toDecimal(previous).abs()).toFixed());
}

function kpiCard(
  id: DashboardKpiId,
  value: MoneyString,
  previousValue: MoneyString | null,
  secondaryValue: MoneyString | null = null,
): KpiCardDTO {
  return {
    id,
    unit: DASHBOARD_KPI_UNITS[id],
    value,
    previousValue,
    changePercent: changePercent(value, previousValue),
    secondaryValue,
  };
}

// ───────────────────────────── Sections ─────────────────────────────

function kpiCards(db: MockStore, month: MonthKey, today: DateOnly, financial: boolean) {
  const previous = shiftMonth(month, -1);
  const close = closeOf(month, today);
  const previousClose = closeOf(previous, today);
  const activeProjects = db.projects.filter(
    (row) => !row.archivedAt && ACTIVE_PROJECT_STATUSES.has(row.status),
  ).length;

  if (!financial) {
    return DASHBOARD_KPI_ID_VALUES.map((id) =>
      id === "ACTIVE_PROJECTS"
        ? kpiCard(id, String(activeProjects), null)
        : kpiCard(id, ZERO, null),
    );
  }

  const collected = collectedUsd(db, monthStart(month), monthEnd(month));
  const collectedBefore = collectedUsd(db, monthStart(previous), monthEnd(previous));
  const expenses = paidExpensesUsd(db, monthStart(month), monthEnd(month));
  const expensesBefore = paidExpensesUsd(db, monthStart(previous), monthEnd(previous));
  const receivable = receivableAt(db, close);
  const accountsBalance = sumMoney(
    db.accounts.filter((row) => row.active).map((row) => row.balanceUsd ?? ZERO),
  );
  const cards: Record<DashboardKpiId, KpiCardDTO> = {
    COLLECTED_MONTH: kpiCard("COLLECTED_MONTH", collected, collectedBefore),
    BILLED_MONTH: kpiCard(
      "BILLED_MONTH",
      billedUsd(db, monthStart(month), monthEnd(month)),
      billedUsd(db, monthStart(previous), monthEnd(previous)),
    ),
    RECEIVABLE: kpiCard(
      "RECEIVABLE",
      receivable.total,
      receivableAt(db, previousClose).total,
      receivable.overdue,
    ),
    EXPENSES_MONTH: kpiCard("EXPENSES_MONTH", expenses, expensesBefore),
    RESULT_MONTH: kpiCard(
      "RESULT_MONTH",
      subMoney(collected, expenses),
      subMoney(collectedBefore, expensesBefore),
    ),
    ACCOUNTS_BALANCE: kpiCard("ACCOUNTS_BALANCE", accountsBalance, null),
    MRR: kpiCard("MRR", mrrAt(db, close), mrrAt(db, previousClose)),
    ACTIVE_PROJECTS: kpiCard("ACTIVE_PROJECTS", String(activeProjects), null),
  };
  return DASHBOARD_KPI_ID_VALUES.map((id) => cards[id]);
}

function incomeVsExpenses(db: MockStore, month: MonthKey, financial: boolean) {
  const periods = Array.from({ length: CHART_MONTHS }, (_, index) =>
    shiftMonth(month, index - CHART_MONTHS + 1),
  );
  const values = (fn: (from: DateOnly, to: DateOnly) => MoneyString) =>
    periods.map((period) => (financial ? fn(monthStart(period), monthEnd(period)) : ZERO));
  return {
    periods,
    series: [
      { id: "income", values: values((from, to) => collectedUsd(db, from, to)) },
      { id: "expenses", values: values((from, to) => paidExpensesUsd(db, from, to)) },
    ],
  };
}

function invoicesDue(db: MockStore, today: DateOnly): DashboardInvoiceRow[] {
  return db.invoices
    .filter((row) => isIssued(row) && OPEN_INVOICE_STATUSES.has(row.status))
    .filter((row) => compareMoney(row.totals.balance, ZERO) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code))
    .slice(0, TOP_INVOICES)
    .flatMap((row) => {
      const invoice = resolveEntityRef(db, "INVOICE", row.id);
      if (!invoice) return [];
      return [
        {
          invoice,
          client: row.client,
          dueDate: row.dueDate,
          currency: row.currency,
          balance: row.totals.balance,
          balanceUsd: compareMoney(row.totals.balanceUsd, ZERO) > 0 ? row.totals.balanceUsd : ZERO,
          daysUntilDue: daysBetween(today, row.dueDate),
        },
      ];
    });
}

/** Pending installments due within the window, overdue ones included (they still need an invoice). */
function installmentsToInvoice(db: MockStore, today: DateOnly): DashboardInstallmentRow[] {
  const until = addDays(today, WINDOW_DAYS);
  return db.installments
    .filter((row) => row.status === "PENDIENTE" && row.dueDate !== null && row.dueDate <= until)
    .filter((row) => !db.projects.find((project) => project.id === row.projectId)?.archivedAt)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.order - b.order)
    .flatMap((row) => {
      const installment = resolveEntityRef(db, "INSTALLMENT", row.id);
      const project = resolveEntityRef(db, "PROJECT", row.projectId);
      if (!installment || !project) return [];
      return [
        { installment, project, amount: row.amount, currency: row.currency, dueDate: row.dueDate },
      ];
    });
}

function documentsExpiring(db: MockStore, today: DateOnly): DashboardDocumentRow[] {
  const until = addDays(today, WINDOW_DAYS);
  return db.documents
    .filter((row) => !row.archivedAt && row.status !== "ANULADO" && row.status !== "VENCIDO")
    .filter((row) => inRange(row.expiresAt, today, until))
    .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""))
    .flatMap((row) => {
      const document = resolveEntityRef(db, "DOCUMENT", row.id);
      if (!document || row.expiresAt === null) return [];
      return [{ document, expiresAt: row.expiresAt, daysLeft: daysBetween(today, row.expiresAt) }];
    });
}

/**
 * Generated recurring expenses still pending within the window (their own snapshot), plus the next period
 * of each active recurring expense due within it. A template in another currency is valued at the rate of
 * its latest generated expense; without one it is left out (never today's rate).
 */
function upcomingRecurringExpenses(db: MockStore, today: DateOnly): DashboardRecurringExpenseRow[] {
  const until = addDays(today, WINDOW_DAYS);
  const rows: DashboardRecurringExpenseRow[] = [];
  for (const expense of db.expenses) {
    if (!expense.recurring || expense.status !== "PENDIENTE" || expense.dueDate === null) continue;
    if (expense.dueDate > until) continue;
    const ref = resolveEntityRef(db, "EXPENSE", expense.id);
    if (!ref) continue;
    rows.push({
      expense: ref,
      dueDate: expense.dueDate,
      amount: expense.amount,
      currency: expense.currency,
      amountUsd: expense.amountUsd,
    });
  }
  for (const template of db.recurringExpenses) {
    if (template.status !== "ACTIVO" || !inRange(template.nextDueDate, today, until)) continue;
    const latest = db.expenses
      .filter((row) => row.recurringExpense?.id === template.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const amountUsd =
      template.currency === "USD"
        ? template.amount
        : latest
          ? toUsd(template.amount, latest.usdRate)
          : null;
    const ref: EntityRef | null = resolveEntityRef(db, "RECURRING_EXPENSE", template.id);
    if (amountUsd === null || !ref || template.nextDueDate === null) continue;
    rows.push({
      expense: ref,
      dueDate: template.nextDueDate,
      amount: template.amount,
      currency: template.currency,
      amountUsd,
    });
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function recentActivity(db: MockStore): DashboardActivityRow[] {
  return [...db.activity]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, RECENT_EVENTS)
    .map((row) => {
      const user = row.actorId ? db.users.find((item) => item.id === row.actorId) : undefined;
      const entity =
        row.entityId === null
          ? null
          : (resolveEntityRef(db, row.entityType, row.entityId) ?? {
              id: row.entityId,
              label: row.entityLabel ?? row.entityId,
              type: row.entityType,
            });
      return {
        id: row.id,
        action: row.action,
        entity,
        actorName: user?.name ?? null,
        createdAt: row.createdAt,
      };
    });
}

// ───────────────────────────── Service ─────────────────────────────

export async function getDashboard(
  ctx: MockServiceContext,
  input: DashboardQuery,
): Promise<DashboardDTO> {
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const month = input.month ?? today.slice(0, 7);
  const financial = canSeeFinancials(ctx.user);
  return {
    month,
    currency: "USD",
    kpis: kpiCards(db, month, today, financial),
    incomeVsExpenses: incomeVsExpenses(db, month, financial),
    invoicesDue: financial ? invoicesDue(db, today) : [],
    installmentsToInvoice: financial ? installmentsToInvoice(db, today) : [],
    documentsExpiring: can(ctx.user, "read", "document") ? documentsExpiring(db, today) : [],
    upcomingRecurringExpenses: financial ? upcomingRecurringExpenses(db, today) : [],
    recentActivity: can(ctx.user, "read", "activity") ? recentActivity(db) : [],
  };
}
