// MOCK — reports and KPIs of Hito 1 (PRD §8.13, HU-31, A1). `fn(ctx, input)`, framework-free (C11). Every
// amount is USD summed from the snapshots stored on each record (C16), never converted with today's rate;
// KPI formulas come from `lib/finance/kpis.ts` (C17). Owner/Admin only (`report`). Replaced by
// `src/server/services/reports.service.ts` in Hito 2 (C9).
//
// Range: presets resolve from `ctx.now` in Caracas to whole calendar months (THIS_MONTH, PREVIOUS_MONTH, the
// calendar QUARTER and YEAR, LAST_12_MONTHS = the current month and the 11 before); CUSTOM is taken as is.
// The "close" of a range is its last day, or today while it runs (receivables, delinquency, DSO).
// Filters: `clientId` / `projectId` / `tagId` narrow invoices (by client or line project), payments (by
// client or the invoices they pay), expenses (by project) and the client and project KPIs. Account
// transfers and manual movements belong to no client or project, so a narrowed account flow leaves them out.
// Attribution: collected per client follows the payment's client; collected per project follows the
// confirmed allocations, split across the invoice's project lines by net amount.
// KPI cards: the previous period is the one just before, of the same length (whole months shift by
// months); `changePercent` is `null` when the previous value is missing or zero. The sparkline holds the
// KPI over each of the 12 months ending at the range's last month (months without data are left out).
import { addDays, daysBetween, todayInCaracas, toDateOnly, type DateOnly } from "@/lib/dates";
import {
  computeArr,
  computeAvgProjectDuration,
  computeAvgProjectTicket,
  computeClientLtv,
  computeCollectionRate,
  computeDelinquency,
  computeDocumentCoverage,
  computeDso,
  computeFixedMonthlyExpense,
  computeMrr,
  computeOnTimeProjects,
  computeOperatingMargin,
  computeProjectMargin,
  computeProspectConversion,
  computeRevenueConcentration,
  computeRunway,
  computeStackUsage,
  countNewClients,
  type KpiDeliveredProject,
  type KpiPeriod,
  type KpiRecurringItem,
} from "@/lib/finance";
import {
  addMoney,
  compareMoney,
  roundMoney,
  subMoney,
  sumMoney,
  toDecimal,
  toUsd,
  type MoneyString,
} from "@/lib/money";
import type { EntityRef } from "@/lib/validators/common";
import type { MonthKey, SeriesPoint } from "@/lib/validators/dashboard";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import type { PaymentDetailDTO } from "@/lib/validators/payments";
import type { ExpenseDetailDTO } from "@/lib/validators/expenses";
import {
  KPI_UNITS,
  type GetKpiInput,
  type GetReportInput,
  type IvaByRateRow,
  type KpiId,
  type KpiResultDTO,
  type ReportFilter,
  type ReportResult,
  type ResolvedRange,
  type TaxesRegisteredReport,
} from "@/lib/validators/reports";
import { can } from "@/server/auth/permissions";
import { ServiceError, type MockServiceContext } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import type { MockStore, ProjectRow } from "../store";

const ZERO = "0.00";
const SPARKLINE_MONTHS = 12;
const TOP_BREAKDOWN = 5;
const CONTRACT_TYPE_ID = "dtyp_contrato_servicios";
const NDA_TYPE_ID = "dtyp_nda";

type Scope = Pick<ReportFilter, "clientId" | "projectId" | "tagId">;

// ───────────────────────────── Dates ─────────────────────────────

function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, index - 1 + delta, 1)).toISOString().slice(0, 7);
}

const monthStart = (month: MonthKey): DateOnly => `${month}-01`;
const monthEnd = (month: MonthKey): DateOnly => addDays(monthStart(shiftMonth(month, 1)), -1);
const monthOf = (date: DateOnly): MonthKey => date.slice(0, 7);
const inRange = (date: DateOnly | null | undefined, range: KpiPeriod) =>
  date != null && date >= range.from && date <= range.to;
const minDate = (a: DateOnly, b: DateOnly) => (a < b ? a : b);

function monthsOf(range: KpiPeriod): MonthKey[] {
  const out: MonthKey[] = [];
  for (let month = monthOf(range.from); month <= monthOf(range.to); month = shiftMonth(month, 1)) {
    out.push(month);
  }
  return out;
}

function resolveRange(filter: ReportFilter, today: DateOnly): KpiPeriod {
  const month = monthOf(today);
  const months = (first: MonthKey, last: MonthKey) => ({
    from: monthStart(first),
    to: monthEnd(last),
  });
  switch (filter.preset) {
    case "THIS_MONTH":
      return months(month, month);
    case "PREVIOUS_MONTH":
      return months(shiftMonth(month, -1), shiftMonth(month, -1));
    case "QUARTER": {
      const first = shiftMonth(month, -((Number(month.slice(5)) - 1) % 3));
      return months(first, shiftMonth(first, 2));
    }
    case "YEAR":
      return months(`${month.slice(0, 4)}-01`, `${month.slice(0, 4)}-12`);
    case "LAST_12_MONTHS":
      return months(shiftMonth(month, -11), month);
    case "CUSTOM":
      return { from: filter.dateFrom ?? today, to: filter.dateTo ?? today };
  }
}

/** The period just before, of the same length: whole months shift by months, other ranges by days. */
function previousPeriod(range: KpiPeriod): KpiPeriod {
  if (range.from.endsWith("-01") && range.to === monthEnd(monthOf(range.to))) {
    const count = monthsOf(range).length;
    return {
      from: monthStart(shiftMonth(monthOf(range.from), -count)),
      to: monthEnd(shiftMonth(monthOf(range.to), -count)),
    };
  }
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.to, -days) };
}

const toResolved = (range: KpiPeriod): ResolvedRange => ({
  dateFrom: range.from,
  dateTo: range.to,
});

// ───────────────────────────── Scope ─────────────────────────────

const isScoped = (scope: Scope) => !!(scope.clientId || scope.projectId || scope.tagId);

function clientInScope(db: MockStore, clientId: string, scope: Scope): boolean {
  if (scope.clientId && clientId !== scope.clientId) return false;
  if (scope.projectId) {
    const project = db.projects.find((row) => row.id === scope.projectId);
    if (!project?.clients.some((link) => link.clientId === clientId)) return false;
  }
  if (scope.tagId && !db.clients.find((row) => row.id === clientId)?.tagIds.includes(scope.tagId)) {
    return false;
  }
  return true;
}

function projectInScope(project: ProjectRow, scope: Scope): boolean {
  if (scope.projectId && project.id !== scope.projectId) return false;
  if (scope.clientId && !project.clients.some((link) => link.clientId === scope.clientId)) {
    return false;
  }
  if (scope.tagId && !project.tagIds.includes(scope.tagId)) return false;
  return true;
}

function projectIdInScope(db: MockStore, projectId: string | undefined, scope: Scope): boolean {
  if (!isScoped(scope)) return true;
  const project = projectId ? db.projects.find((row) => row.id === projectId) : undefined;
  return !!project && projectInScope(project, scope);
}

function invoiceInScope(db: MockStore, invoice: InvoiceDetailDTO, scope: Scope): boolean {
  if (!isScoped(scope)) return true;
  if (scope.clientId && invoice.client.id !== scope.clientId) return false;
  const projectIds = invoice.lines.flatMap((line) => (line.project ? [line.project.id] : []));
  if (scope.projectId && !projectIds.includes(scope.projectId)) return false;
  if (scope.tagId) {
    const tagged =
      db.clients.find((row) => row.id === invoice.client.id)?.tagIds.includes(scope.tagId) ||
      projectIds.some((id) =>
        db.projects.find((row) => row.id === id)?.tagIds.includes(scope.tagId!),
      );
    if (!tagged) return false;
  }
  return true;
}

function paymentInScope(db: MockStore, payment: PaymentDetailDTO, scope: Scope): boolean {
  if (!isScoped(scope)) return true;
  if (scope.clientId && payment.client.id !== scope.clientId) return false;
  if (scope.projectId || scope.tagId) {
    const paysScoped = db.paymentAllocations
      .filter((row) => row.paymentId === payment.id)
      .some((row) => {
        const invoice = db.invoices.find((item) => item.id === row.invoice.id);
        return !!invoice && invoiceInScope(db, invoice, { ...scope, clientId: undefined });
      });
    const clientTagged =
      !scope.projectId &&
      !!scope.tagId &&
      !!db.clients.find((row) => row.id === payment.client.id)?.tagIds.includes(scope.tagId);
    if (!paysScoped && !clientTagged) return false;
  }
  return true;
}

const expenseInScope = (db: MockStore, expense: ExpenseDetailDTO, scope: Scope) =>
  projectIdInScope(db, expense.project?.id, scope);

// ───────────────────────────── Sources ─────────────────────────────

const isIssued = (row: InvoiceDetailDTO) =>
  !row.isDraft && row.status !== "BORRADOR" && row.status !== "ANULADA" && !row.archivedAt;

function payments(db: MockStore, scope: Scope, range: KpiPeriod) {
  return db.payments.filter(
    (row) =>
      row.status === "CONFIRMADO" && inRange(row.date, range) && paymentInScope(db, row, scope),
  );
}

function invoices(db: MockStore, scope: Scope, range: KpiPeriod) {
  return db.invoices.filter(
    (row) => isIssued(row) && inRange(row.issueDate, range) && invoiceInScope(db, row, scope),
  );
}

function paidExpenses(db: MockStore, scope: Scope, range: KpiPeriod) {
  return db.expenses.filter(
    (row) =>
      row.status === "PAGADO" &&
      inRange(row.paidAt ?? row.date, range) &&
      expenseInScope(db, row, scope),
  );
}

const collectedUsd = (db: MockStore, scope: Scope, range: KpiPeriod) =>
  sumMoney(payments(db, scope, range).map((row) => row.amountUsd));
const billedUsd = (db: MockStore, scope: Scope, range: KpiPeriod) =>
  sumMoney(invoices(db, scope, range).map((row) => row.totals.totalUsd));
const expensesUsd = (db: MockStore, scope: Scope, range: KpiPeriod) =>
  sumMoney(paidExpenses(db, scope, range).map((row) => row.amountUsd));

/** Confirmed allocations with the payment date and the invoice's client, in USD. */
function allocations(db: MockStore, scope: Scope, upTo: DateOnly) {
  return db.paymentAllocations.flatMap((row) => {
    const payment = db.payments.find((item) => item.id === row.paymentId);
    const invoice = db.invoices.find((item) => item.id === row.invoice.id);
    if (!payment || payment.status !== "CONFIRMADO" || payment.date > upTo || !invoice) return [];
    if (!invoiceInScope(db, invoice, scope)) return [];
    return [{ invoice, date: payment.date, clientId: invoice.client.id, amountUsd: row.amountUsd }];
  });
}

/** Open balance of each issued invoice at the end of `asOf`, in USD at the invoice's own rate. */
function balancesAt(db: MockStore, scope: Scope, asOf: DateOnly) {
  const out: { invoice: InvoiceDetailDTO; balanceUsd: MoneyString; daysPastDue: number }[] = [];
  for (const invoice of db.invoices) {
    if (!isIssued(invoice) || invoice.issueDate > asOf || !invoiceInScope(db, invoice, scope)) {
      continue;
    }
    const applied = db.paymentAllocations
      .filter((row) => row.invoice.id === invoice.id)
      .filter((row) => {
        const payment = db.payments.find((item) => item.id === row.paymentId);
        return payment?.status === "CONFIRMADO" && payment.date <= asOf;
      })
      .map((row) => row.amountInvoiceCurrency);
    const balance = subMoney(invoice.totals.receivable, sumMoney(applied));
    if (compareMoney(balance, ZERO) <= 0) continue;
    out.push({
      invoice,
      balanceUsd: toUsd(balance, invoice.usdRate),
      daysPastDue: daysBetween(invoice.dueDate, asOf),
    });
  }
  return out;
}

function receivableAt(db: MockStore, scope: Scope, asOf: DateOnly) {
  const balances = balancesAt(db, scope, asOf);
  return {
    total: sumMoney(balances.map((row) => row.balanceUsd)),
    overdue: sumMoney(balances.filter((row) => row.daysPastDue > 0).map((row) => row.balanceUsd)),
  };
}

/** Collected per project: each allocation split across its invoice's project lines by net amount. */
function collectedByProject(
  db: MockStore,
  scope: Scope,
  range: KpiPeriod,
): Map<string, MoneyString> {
  const totals = new Map<string, MoneyString>();
  for (const allocation of allocations(db, scope, range.to)) {
    if (allocation.date < range.from) continue;
    const lines = allocation.invoice.lines.filter((line) => line.project);
    const net = sumMoney(allocation.invoice.lines.map((line) => line.netAmount));
    if (lines.length === 0 || toDecimal(net).isZero()) continue;
    for (const line of lines) {
      const projectId = line.project!.id;
      if (!projectIdInScope(db, projectId, scope)) continue;
      const share = roundMoney(
        toDecimal(allocation.amountUsd)
          .times(toDecimal(line.netAmount))
          .dividedBy(toDecimal(net))
          .toFixed(),
      );
      totals.set(projectId, addMoney(totals.get(projectId) ?? ZERO, share));
    }
  }
  return totals;
}

function expensesByProject(
  db: MockStore,
  scope: Scope,
  range: KpiPeriod,
): Map<string, MoneyString> {
  const totals = new Map<string, MoneyString>();
  for (const expense of paidExpenses(db, scope, range)) {
    if (!expense.project) continue;
    totals.set(
      expense.project.id,
      addMoney(totals.get(expense.project.id) ?? ZERO, expense.amountUsd),
    );
  }
  return totals;
}

/** Monthly recurring items in USD: a USD amount as is, another currency at its own snapshot rate. */
function recurringChargeItems(db: MockStore, scope: Scope, asOf: DateOnly): KpiRecurringItem[] {
  return db.recurringCharges.flatMap((charge) => {
    if (charge.startDate > asOf || (charge.endDate !== null && charge.endDate < asOf)) return [];
    if (!projectIdInScope(db, charge.projectId, scope)) return [];
    const plan = db.billingPlans.find((row) => row.projectId === charge.projectId);
    const amountUsd =
      charge.currency === "USD"
        ? charge.amount
        : plan?.currency === charge.currency && plan.usdRate !== null
          ? toUsd(charge.amount, plan.usdRate)
          : null;
    return amountUsd === null
      ? []
      : [{ amountUsd, frequency: charge.frequency, status: charge.status }];
  });
}

function recurringExpenseItems(db: MockStore, scope: Scope): KpiRecurringItem[] {
  return db.recurringExpenses.flatMap((template) => {
    if (!projectIdInScope(db, template.project?.id, scope)) return [];
    const latest = db.expenses
      .filter((row) => row.recurringExpense?.id === template.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const amountUsd =
      template.currency === "USD"
        ? template.amount
        : latest
          ? toUsd(template.amount, latest.usdRate)
          : null;
    return amountUsd === null
      ? []
      : [{ amountUsd, frequency: template.frequency, status: template.status }];
  });
}

const ref = (db: MockStore, type: EntityRef["type"], id: string): EntityRef =>
  resolveEntityRef(db, type, id) ?? { id, label: id, type };

const percentShare = (part: MoneyString, total: MoneyString) =>
  toDecimal(total).isZero()
    ? ZERO
    : roundMoney(toDecimal(part).times(100).dividedBy(toDecimal(total)).toFixed());

// ───────────────────────────── Reports ─────────────────────────────

function monthlyPoints(range: KpiPeriod, value: (month: KpiPeriod) => MoneyString): SeriesPoint[] {
  return monthsOf(range).map((period) => ({
    period,
    value: value({
      from: monthStart(period) < range.from ? range.from : monthStart(period),
      to: minDate(monthEnd(period), range.to),
    }),
  }));
}

function addRate(rows: IvaByRateRow[], rate: string, taxBase: MoneyString, ivaAmount: MoneyString) {
  const row = rows.find((item) => toDecimal(item.ivaRate).equals(toDecimal(rate)));
  if (row) {
    row.taxBase = addMoney(row.taxBase, taxBase);
    row.ivaAmount = addMoney(row.ivaAmount, ivaAmount);
  } else {
    rows.push({ ivaRate: rate, taxBase: roundMoney(taxBase), ivaAmount: roundMoney(ivaAmount) });
  }
}

type TaxesPeriod = TaxesRegisteredReport["totals"];

function taxesOf(db: MockStore, scope: Scope, range: KpiPeriod): TaxesPeriod {
  const ivaByRate: IvaByRateRow[] = [];
  const withheld = {
    iva: [] as MoneyString[],
    islr: [] as MoneyString[],
    other: [] as MoneyString[],
  };
  for (const invoice of invoices(db, scope, range)) {
    for (const line of invoice.taxLines) {
      addRate(
        ivaByRate,
        line.ivaRate,
        toUsd(line.taxBase, invoice.usdRate),
        toUsd(line.ivaAmount, invoice.usdRate),
      );
    }
    withheld.iva.push(toUsd(invoice.totals.ivaWithheld, invoice.usdRate));
    withheld.islr.push(toUsd(invoice.totals.islrWithheld, invoice.usdRate));
    withheld.other.push(toUsd(invoice.totals.otherWithheld, invoice.usdRate));
  }
  ivaByRate.sort((a, b) => toDecimal(b.ivaRate).comparedTo(toDecimal(a.ivaRate)));
  return {
    ivaByRate,
    ivaTotal: sumMoney(ivaByRate.map((row) => row.ivaAmount)),
    ivaWithheld: sumMoney(withheld.iva),
    islrWithheld: sumMoney(withheld.islr),
    otherWithheld: sumMoney(withheld.other),
    igtf: sumMoney(payments(db, scope, range).map((row) => toUsd(row.igtfAmount, row.usdRate))),
  };
}

function accountFlow(db: MockStore, scope: Scope, range: KpiPeriod) {
  const rows = new Map<
    string,
    { account: EntityRef; period: MonthKey; inflow: string; outflow: string }
  >();
  const add = (accountId: string, date: DateOnly, inflow: MoneyString, outflow: MoneyString) => {
    const key = `${accountId}|${monthOf(date)}`;
    const row = rows.get(key) ?? {
      account: ref(db, "ACCOUNT", accountId),
      period: monthOf(date),
      inflow: ZERO,
      outflow: ZERO,
    };
    row.inflow = addMoney(row.inflow, inflow);
    row.outflow = addMoney(row.outflow, outflow);
    rows.set(key, row);
  };
  for (const payment of payments(db, scope, range)) {
    add(payment.account.id, payment.date, toUsd(payment.netCredited, payment.usdRate), ZERO);
  }
  for (const expense of paidExpenses(db, scope, range)) {
    if (expense.account)
      add(expense.account.id, expense.paidAt ?? expense.date, ZERO, expense.amountUsd);
  }
  if (!isScoped(scope)) {
    for (const transfer of db.transfers) {
      if (!inRange(transfer.date, range)) continue;
      add(transfer.fromAccount.id, transfer.date, ZERO, transfer.amountUsd);
      add(transfer.toAccount.id, transfer.date, transfer.amountUsd, ZERO);
    }
    for (const movement of db.movements) {
      if (!inRange(movement.date, range)) continue;
      const amount = toDecimal(movement.amountUsd).abs().toFixed(2);
      const outgoing =
        movement.type === "RETIRO_SOCIO" ||
        (movement.type === "AJUSTE" && toDecimal(movement.amountUsd).isNegative());
      add(movement.account.id, movement.date, outgoing ? ZERO : amount, outgoing ? amount : ZERO);
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.period.localeCompare(b.period) || a.account.label.localeCompare(b.account.label),
  );
}

function buildReport(
  db: MockStore,
  input: GetReportInput,
  range: KpiPeriod,
  today: DateOnly,
): ReportResult {
  const scope: Scope = input.filter;
  const base = { currency: "USD" as const, range: toResolved(range) };
  const close = minDate(range.to, today);
  const periods = monthsOf(range);
  switch (input.id) {
    case "COLLECTED_BY_MONTH":
      return {
        ...base,
        reportId: input.id,
        points: monthlyPoints(range, (month) => collectedUsd(db, scope, month)),
      };
    case "BILLED_VS_COLLECTED":
      return {
        ...base,
        reportId: input.id,
        chart: {
          periods,
          series: [
            {
              id: "billed",
              values: monthlyPoints(range, (m) => billedUsd(db, scope, m)).map((p) => p.value),
            },
            {
              id: "collected",
              values: monthlyPoints(range, (m) => collectedUsd(db, scope, m)).map((p) => p.value),
            },
          ],
        },
      };
    case "REVENUE_BY_CLIENT": {
      const totals = new Map<string, { collected: MoneyString[]; billed: MoneyString[] }>();
      const slot = (clientId: string) => {
        const entry = totals.get(clientId) ?? { collected: [], billed: [] };
        totals.set(clientId, entry);
        return entry;
      };
      for (const payment of payments(db, scope, range))
        slot(payment.client.id).collected.push(payment.amountUsd);
      for (const invoice of invoices(db, scope, range))
        slot(invoice.client.id).billed.push(invoice.totals.totalUsd);
      const rows = [...totals].map(([clientId, entry]) => ({
        client: ref(db, "CLIENT", clientId),
        collected: sumMoney(entry.collected),
        billed: sumMoney(entry.billed),
      }));
      rows.sort(
        (a, b) => compareMoney(b.collected, a.collected) || compareMoney(b.billed, a.billed),
      );
      return { ...base, reportId: input.id, rows };
    }
    case "REVENUE_BY_PROJECT": {
      const collected = collectedByProject(db, scope, range);
      const expenses = expensesByProject(db, scope, range);
      const rows = [...new Set([...collected.keys(), ...expenses.keys()])].map((projectId) => {
        const collectedUsd = collected.get(projectId) ?? ZERO;
        const expenseUsd = expenses.get(projectId) ?? ZERO;
        return {
          project: ref(db, "PROJECT", projectId),
          collected: collectedUsd,
          margin: subMoney(collectedUsd, expenseUsd),
          marginPercent: computeProjectMargin({
            collectedUsd,
            allocatedExpensesUsd: expenseUsd,
          }),
        };
      });
      rows.sort(
        (a, b) => compareMoney(b.collected, a.collected) || compareMoney(b.margin, a.margin),
      );
      return { ...base, reportId: input.id, rows };
    }
    case "RECEIVABLES_AGING": {
      const empty = () => ({ d0_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90plus: ZERO });
      const totals = empty();
      const byClient = new Map<string, ReturnType<typeof empty>>();
      for (const row of balancesAt(db, scope, close)) {
        const bucket =
          row.daysPastDue <= 30
            ? "d0_30"
            : row.daysPastDue <= 60
              ? "d31_60"
              : row.daysPastDue <= 90
                ? "d61_90"
                : "d90plus";
        const buckets = byClient.get(row.invoice.client.id) ?? empty();
        buckets[bucket] = addMoney(buckets[bucket], row.balanceUsd);
        totals[bucket] = addMoney(totals[bucket], row.balanceUsd);
        byClient.set(row.invoice.client.id, buckets);
      }
      const rows = [...byClient].map(([clientId, buckets]) => ({
        client: ref(db, "CLIENT", clientId),
        buckets,
        total: sumMoney(Object.values(buckets)),
      }));
      rows.sort((a, b) => compareMoney(b.total, a.total));
      return { ...base, reportId: input.id, rows, totals };
    }
    case "EXPENSES_BY_MONTH_CATEGORY": {
      const categories = new Map<string, string>();
      for (const expense of paidExpenses(db, scope, range)) {
        categories.set(expense.category.id, expense.category.name);
      }
      const series = [...categories].map(([id, label]) => ({
        id,
        label,
        values: monthlyPoints(range, (month) =>
          sumMoney(
            paidExpenses(db, scope, month)
              .filter((row) => row.category.id === id)
              .map((row) => row.amountUsd),
          ),
        ).map((point) => point.value),
      }));
      return { ...base, reportId: input.id, chart: { periods, series } };
    }
    case "NET_RESULT_MONTHLY":
      return {
        ...base,
        reportId: input.id,
        points: monthlyPoints(range, (month) =>
          subMoney(collectedUsd(db, scope, month), expensesUsd(db, scope, month)),
        ),
      };
    case "ACCOUNT_FLOW":
      return { ...base, reportId: input.id, rows: accountFlow(db, scope, range) };
    case "COLLECTIONS_BY_METHOD": {
      const byMethod = new Map<string, { code: string; amounts: MoneyString[] }>();
      for (const payment of payments(db, scope, range)) {
        const entry = byMethod.get(payment.method.id) ?? { code: payment.method.code, amounts: [] };
        entry.amounts.push(payment.amountUsd);
        byMethod.set(payment.method.id, entry);
      }
      const total = collectedUsd(db, scope, range);
      const rows = [...byMethod].map(([methodId, entry]) => {
        const collected = sumMoney(entry.amounts);
        return {
          methodId,
          methodCode: entry.code,
          collected,
          share: percentShare(collected, total),
        };
      });
      rows.sort((a, b) => compareMoney(b.collected, a.collected));
      return { ...base, reportId: input.id, rows };
    }
    case "TAXES_REGISTERED": {
      const months = periods.map((period) => ({
        period,
        ...taxesOf(db, scope, {
          from: monthStart(period) < range.from ? range.from : monthStart(period),
          to: minDate(monthEnd(period), range.to),
        }),
      }));
      return { ...base, reportId: input.id, months, totals: taxesOf(db, scope, range) };
    }
  }
}

// ───────────────────────────── KPIs ─────────────────────────────

interface KpiValue {
  value: MoneyString | null;
  breakdown?: KpiResultDTO["breakdown"];
}

const caracasDay = (timestamp: string | null) =>
  timestamp ? toDateOnly(new Date(timestamp)) : null;

function deliveredProjects(db: MockStore, scope: Scope, range: KpiPeriod): KpiDeliveredProject[] {
  return db.projects
    .filter((row) => !row.archivedAt && projectInScope(row, scope) && inRange(row.endDate, range))
    .map((row) => ({
      startDate: row.startDate,
      estimatedEndDate: row.targetEndDate,
      deliveredDate: row.endDate,
    }));
}

/** Documents linked to the project or to one of its clients, not archived. */
function documentsAround(db: MockStore, project: ProjectRow) {
  const targets = new Set([project.id, ...project.clients.map((link) => link.clientId)]);
  const ids = new Set(
    db.documentLinks.filter((link) => targets.has(link.entityId)).map((link) => link.documentId),
  );
  return db.documents.filter((row) => ids.has(row.id) && !row.archivedAt);
}

function kpiValue(
  db: MockStore,
  id: KpiId,
  range: KpiPeriod,
  scope: Scope,
  today: DateOnly,
): KpiValue {
  const close = minDate(range.to, today);
  switch (id) {
    case "MRR":
      return { value: computeMrr(recurringChargeItems(db, scope, range.to)) };
    case "ARR":
      return { value: computeArr(computeMrr(recurringChargeItems(db, scope, range.to))) };
    case "DSO":
      return {
        value: computeDso({
          receivableUsd: receivableAt(db, scope, close).total,
          billedUsd: billedUsd(db, scope, range),
          period: range,
        }),
      };
    case "COLLECTION_RATE":
      return {
        value: computeCollectionRate({
          collectedUsd: collectedUsd(db, scope, range),
          billedUsd: billedUsd(db, scope, range),
        }),
      };
    case "DELINQUENCY": {
      const receivable = receivableAt(db, scope, close);
      return {
        value: computeDelinquency({
          overdueUsd: receivable.overdue,
          receivableUsd: receivable.total,
        }),
      };
    }
    case "PROJECT_MARGIN": {
      const collected = collectedByProject(db, scope, range);
      const expenses = expensesByProject(db, scope, range);
      const breakdown = [...collected].flatMap(([projectId, collectedUsd]) => {
        const margin = computeProjectMargin({
          collectedUsd,
          allocatedExpensesUsd: expenses.get(projectId) ?? ZERO,
        });
        return margin === null
          ? []
          : [{ key: projectId, label: ref(db, "PROJECT", projectId).label, value: margin }];
      });
      return {
        value: computeProjectMargin({
          collectedUsd: sumMoney([...collected.values()]),
          allocatedExpensesUsd: sumMoney(
            [...expenses].filter(([projectId]) => collected.has(projectId)).map(([, usd]) => usd),
          ),
        }),
        breakdown: breakdown.slice(0, TOP_BREAKDOWN),
      };
    }
    case "OPERATING_MARGIN":
      return {
        value: computeOperatingMargin({
          collectedUsd: collectedUsd(db, scope, range),
          expensesUsd: expensesUsd(db, scope, range),
        }),
      };
    case "FIXED_MONTHLY_EXPENSE":
      return { value: computeFixedMonthlyExpense(recurringExpenseItems(db, scope)) };
    case "RUNWAY": {
      const last = monthOf(range.to);
      const months = [shiftMonth(last, -2), shiftMonth(last, -1), last];
      return {
        value: computeRunway({
          accountsBalanceUsd: sumMoney(
            db.accounts.filter((row) => row.active).map((row) => row.balanceUsd ?? ZERO),
          ),
          lastThreeMonthsExpensesUsd: months.map((month) =>
            expensesUsd(db, scope, { from: monthStart(month), to: monthEnd(month) }),
          ),
        }),
      };
    }
    case "REVENUE_CONCENTRATION": {
      const shares = computeRevenueConcentration(allocations(db, scope, range.to), range.to);
      const breakdown = (["top1", "top3"] as const).flatMap((key) =>
        shares[key] === null ? [] : [{ key, value: shares[key]! }],
      );
      return { value: shares.top1, breakdown };
    }
    case "AVG_PROJECT_TICKET":
      return {
        value: computeAvgProjectTicket(
          db.projects
            .filter((row) => !row.archivedAt && projectInScope(row, scope))
            .map((row) => ({
              startDate: row.startDate,
              contractedUsd:
                db.billingPlans.find((plan) => plan.projectId === row.id)?.contractedUsd ?? null,
            })),
          range,
        ),
      };
    case "CLIENT_LTV": {
      const ltv = computeClientLtv(allocations(db, scope, range.to));
      return {
        value: ltv.averageUsd,
        breakdown: ltv.perClient.slice(0, TOP_BREAKDOWN).map((row) => ({
          key: row.clientId,
          label: ref(db, "CLIENT", row.clientId).label,
          value: row.ltvUsd,
        })),
      };
    }
    case "NEW_CLIENTS":
    case "PROSPECT_CONVERSION": {
      const clients = db.clients
        .filter((row) => !row.archivedAt && clientInScope(db, row.id, scope))
        .map((row) => ({
          createdAt: caracasDay(row.createdAt)!,
          activatedAt: caracasDay(row.activatedAt),
        }));
      return id === "NEW_CLIENTS"
        ? { value: String(countNewClients(clients, range)) }
        : { value: computeProspectConversion(clients, range) };
    }
    case "AVG_PROJECT_DURATION":
      return { value: computeAvgProjectDuration(deliveredProjects(db, scope, range)) };
    case "ON_TIME_PROJECTS":
      return { value: computeOnTimeProjects(deliveredProjects(db, scope, range)) };
    case "STACK_USAGE": {
      const usage = computeStackUsage(
        db.projects
          .filter((row) => !row.archivedAt && projectInScope(row, scope))
          .filter((row) => row.startDate !== null && row.startDate <= range.to)
          .map((row) => ({ technologies: row.technologyIds })),
      );
      return {
        value: String(usage.length),
        breakdown: usage.slice(0, TOP_BREAKDOWN).map((row) => ({
          key: row.technology,
          label: db.technologies.find((tech) => tech.id === row.technology)?.name ?? row.technology,
          value: String(row.projects),
        })),
      };
    }
    case "DOCUMENT_COVERAGE":
      return {
        value: computeDocumentCoverage(
          db.projects
            .filter((row) => !row.archivedAt && projectInScope(row, scope))
            .map((row) => {
              const documents = documentsAround(db, row);
              return {
                status: row.status,
                hasSignedContract: documents.some(
                  (doc) => doc.typeId === CONTRACT_TYPE_ID && doc.status === "FIRMADO",
                ),
                hasCurrentNda: documents.some(
                  (doc) =>
                    doc.typeId === NDA_TYPE_ID &&
                    doc.status !== "VENCIDO" &&
                    doc.status !== "ANULADO" &&
                    (doc.expiresAt === null || doc.expiresAt >= close),
                ),
              };
            }),
        ),
      };
  }
}

function changePercent(
  value: MoneyString | null,
  previous: MoneyString | null,
): MoneyString | null {
  if (value === null || previous === null || toDecimal(previous).isZero()) return null;
  const delta = toDecimal(value).minus(toDecimal(previous));
  return roundMoney(delta.times(100).dividedBy(toDecimal(previous).abs()).toFixed());
}

// ───────────────────────────── Services ─────────────────────────────

function requireReports(ctx: MockServiceContext): void {
  if (!can(ctx.user, "read", "report")) throw new ServiceError("FORBIDDEN");
}

export async function getReport(
  ctx: MockServiceContext,
  input: GetReportInput,
): Promise<ReportResult> {
  requireReports(ctx);
  const today = todayInCaracas(ctx.now);
  return buildReport(ctx.db, input, resolveRange(input.filter, today), today);
}

export async function getKpi(ctx: MockServiceContext, input: GetKpiInput): Promise<KpiResultDTO> {
  requireReports(ctx);
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const scope: Scope = input.filter;
  const range = resolveRange(input.filter, today);
  const current = kpiValue(db, input.id, range, scope, today);
  const previousValue = kpiValue(db, input.id, previousPeriod(range), scope, today).value;
  const last = monthOf(range.to);
  const sparkline = Array.from({ length: SPARKLINE_MONTHS }, (_, index) =>
    shiftMonth(last, index - SPARKLINE_MONTHS + 1),
  ).flatMap((period) => {
    const value = kpiValue(
      db,
      input.id,
      { from: monthStart(period), to: monthEnd(period) },
      scope,
      today,
    ).value;
    return value === null ? [] : [{ period, value }];
  });
  return {
    id: input.id,
    unit: KPI_UNITS[input.id],
    value: current.value,
    previousValue,
    changePercent: changePercent(current.value, previousValue),
    sparkline,
    ...(current.breakdown && { breakdown: current.breakdown }),
  };
}
