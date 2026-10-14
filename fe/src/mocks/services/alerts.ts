// MOCK — in-app alerts of Hito 1 (PRD §7.9). `fn(ctx, input)`, framework-free (C11). The nine rules are
// computed live over the store; "today" is the Caracas business day of `ctx.now` and every date rule is a
// whole-calendar-day comparison, so H2-B6 reproduces them over Prisma. Amounts are compared with
// `compareMoney` (C15). Dismissals and snoozes are per user (`alertDismissals`). Replaced by
// `src/server/services/alerts.service.ts` in Hito 2 (C9).
//
// Boundaries (inclusive/exclusive), `d` = days between today and the date:
//   invoice due soon          0 ≤ d ≤ 7 (day 8 is out)        installment to invoice   d ≤ 7 (past included)
//   document expiring         0 ≤ d ≤ alertDaysBefore         recurring expense        d ≤ 5 (past included)
//   payment to verify         age > 2 days (3 is in)          unallocated credit       age > 15 days (16 is in)
//   missing rate              business day with no VES rate dated today
// Payment age counts from the payment's business `date`. Items are ordered by urgency (fewest days first).
import { daysBetween, isBusinessDay, todayInCaracas } from "@/lib/dates";
import { compareMoney } from "@/lib/money";
import {
  ALERT_TYPE_VALUES,
  buildAlertKey,
  type AlertDTO,
  type AlertDismissalDTO,
  type AlertType,
  type AlertsSummaryDTO,
  type DismissAlertInput,
  type ListAlertsInput,
  type RestoreAlertInput,
  type SnoozeAlertInput,
} from "@/lib/validators/alerts";
import { DEFAULT_ALERT_DAYS_BEFORE } from "@/lib/validators/documents";
import type { EntityRef } from "@/lib/validators/common";
import { can, canSeeFinancials } from "@/server/auth/permissions";
import type { MockServiceContext } from "../ctx";
import { resolveEntityRef } from "../entity-refs";

const INVOICE_DUE_SOON_DAYS = 7;
const INSTALLMENT_DUE_DAYS = 7;
const RECURRING_EXPENSE_DUE_DAYS = 5;
const PAYMENT_VERIFY_AFTER_DAYS = 2;
const UNALLOCATED_AFTER_DAYS = 15;
const DAY_MS = 86_400_000;

const FINANCE_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  "INVOICE_OVERDUE",
  "INVOICE_DUE_SOON",
  "INSTALLMENT_TO_INVOICE",
  "RECURRING_EXPENSE_PENDING",
  "PAYMENT_PENDING_VERIFICATION",
  "UNALLOCATED_CREDIT",
]);
const DOCUMENT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  "DOCUMENT_EXPIRING",
  "DOCUMENT_EXPIRED",
]);

/** Alert types the user may see: finance for Owner/Admin, documents by `read`, the rate by settings `read`. */
function visibleTypes(ctx: MockServiceContext): Set<AlertType> {
  const allowed = new Set<AlertType>();
  for (const type of ALERT_TYPE_VALUES) {
    if (FINANCE_TYPES.has(type)) {
      if (canSeeFinancials(ctx.user)) allowed.add(type);
    } else if (DOCUMENT_TYPES.has(type)) {
      if (can(ctx.user, "read", "document")) allowed.add(type);
    } else if (can(ctx.user, "read", "settings")) {
      allowed.add(type);
    }
  }
  return allowed;
}

function refOf(ctx: MockServiceContext, type: EntityRef["type"], id: string): EntityRef | null {
  return resolveEntityRef(ctx.db, type, id);
}

function computeAlerts(ctx: MockServiceContext, types: ReadonlySet<AlertType>): AlertDTO[] {
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const out: AlertDTO[] = [];
  const push = (
    type: AlertType,
    subject: string,
    fields: Omit<AlertDTO, "alertKey" | "type">,
  ): void => {
    out.push({ alertKey: buildAlertKey(type, subject), type, ...fields });
  };

  if (types.has("INVOICE_OVERDUE")) {
    for (const invoice of db.invoices) {
      if (invoice.archivedAt || invoice.isDraft || invoice.status !== "VENCIDA") continue;
      push("INVOICE_OVERDUE", invoice.id, {
        entity: refOf(ctx, "INVOICE", invoice.id),
        date: invoice.dueDate,
        days: daysBetween(today, invoice.dueDate),
        amount: { amount: invoice.totals.balance, currency: invoice.currency },
        context: invoice.client.label,
      });
    }
  }

  if (types.has("INVOICE_DUE_SOON")) {
    for (const invoice of db.invoices) {
      if (invoice.archivedAt || invoice.isDraft || !["EMITIDA", "PARCIAL"].includes(invoice.status))
        continue;
      const days = daysBetween(today, invoice.dueDate);
      if (days < 0 || days > INVOICE_DUE_SOON_DAYS) continue;
      if (compareMoney(invoice.totals.balance, "0") <= 0) continue;
      push("INVOICE_DUE_SOON", invoice.id, {
        entity: refOf(ctx, "INVOICE", invoice.id),
        date: invoice.dueDate,
        days,
        amount: { amount: invoice.totals.balance, currency: invoice.currency },
        context: invoice.client.label,
      });
    }
  }

  if (types.has("INSTALLMENT_TO_INVOICE")) {
    for (const installment of db.installments) {
      if (installment.status !== "PENDIENTE" || installment.dueDate === null) continue;
      const days = daysBetween(today, installment.dueDate);
      if (days > INSTALLMENT_DUE_DAYS) continue;
      push("INSTALLMENT_TO_INVOICE", installment.id, {
        entity: refOf(ctx, "PROJECT", installment.projectId),
        date: installment.dueDate,
        days,
        amount: { amount: installment.amount, currency: installment.currency },
        context: installment.label,
      });
    }
  }

  if (types.has("DOCUMENT_EXPIRING") || types.has("DOCUMENT_EXPIRED")) {
    for (const document of db.documents) {
      if (document.archivedAt) continue;
      const entity = refOf(ctx, "DOCUMENT", document.id);
      const context = db.documentTypes.find((type) => type.id === document.typeId)?.name ?? null;
      if (document.status === "VENCIDO") {
        if (!types.has("DOCUMENT_EXPIRED")) continue;
        push("DOCUMENT_EXPIRED", document.id, {
          entity,
          date: document.expiresAt,
          days: document.expiresAt ? daysBetween(today, document.expiresAt) : null,
          amount: null,
          context,
        });
        continue;
      }
      if (!types.has("DOCUMENT_EXPIRING") || document.status === "ANULADO") continue;
      if (document.expiresAt === null) continue;
      const days = daysBetween(today, document.expiresAt);
      const window = document.alertDaysBefore ?? DEFAULT_ALERT_DAYS_BEFORE;
      if (days < 0 || days > window) continue;
      push("DOCUMENT_EXPIRING", document.id, {
        entity,
        date: document.expiresAt,
        days,
        amount: null,
        context,
      });
    }
  }

  if (types.has("RECURRING_EXPENSE_PENDING")) {
    for (const expense of db.expenses) {
      if (!expense.recurring || expense.status !== "PENDIENTE" || expense.dueDate === null)
        continue;
      const days = daysBetween(today, expense.dueDate);
      if (days > RECURRING_EXPENSE_DUE_DAYS) continue;
      push("RECURRING_EXPENSE_PENDING", expense.id, {
        entity: refOf(ctx, "EXPENSE", expense.id),
        date: expense.dueDate,
        days,
        amount: { amount: expense.amount, currency: expense.currency },
        context: expense.vendor ?? expense.description,
      });
    }
  }

  if (types.has("PAYMENT_PENDING_VERIFICATION")) {
    for (const payment of db.payments) {
      if (payment.status !== "PENDIENTE_VERIFICACION") continue;
      const age = daysBetween(payment.date, today);
      if (age <= PAYMENT_VERIFY_AFTER_DAYS) continue;
      push("PAYMENT_PENDING_VERIFICATION", payment.id, {
        entity: refOf(ctx, "PAYMENT", payment.id),
        date: payment.date,
        days: -age,
        amount: { amount: payment.amount, currency: payment.currency },
        context: payment.client.label,
      });
    }
  }

  if (types.has("UNALLOCATED_CREDIT")) {
    for (const payment of db.payments) {
      if (payment.status !== "CONFIRMADO" || compareMoney(payment.unallocated, "0") <= 0) continue;
      const age = daysBetween(payment.date, today);
      if (age <= UNALLOCATED_AFTER_DAYS) continue;
      push("UNALLOCATED_CREDIT", payment.id, {
        entity: refOf(ctx, "PAYMENT", payment.id),
        date: payment.date,
        days: -age,
        amount: { amount: payment.unallocated, currency: payment.currency },
        context: payment.client.label,
      });
    }
  }

  if (
    types.has("MISSING_RATE") &&
    isBusinessDay(today) &&
    !db.exchangeRates.some((rate) => rate.currency === "VES" && rate.date === today)
  ) {
    push("MISSING_RATE", `VES:${today}`, {
      entity: null,
      date: today,
      days: 0,
      amount: null,
      context: null,
    });
  }

  return out;
}

/** Keys hidden for the current user: dismissed for good, or snoozed past `now`. */
function hiddenKeys(ctx: MockServiceContext): Set<string> {
  const hidden = new Set<string>();
  for (const row of ctx.db.alertDismissals) {
    if (row.userId !== ctx.user.id) continue;
    if (row.dismissedUntil === null || Date.parse(row.dismissedUntil) > ctx.now.getTime()) {
      hidden.add(row.alertKey);
    }
  }
  return hidden;
}

const TYPE_ORDER = new Map<AlertType, number>(
  ALERT_TYPE_VALUES.map((type, index) => [type, index]),
);

/** `ListAlertsInput` with `types` optional, so `{ limit: 1 }` (the shell counter) is a valid call. */
type ListAlertsArgs = Pick<ListAlertsInput, "limit"> & { types?: ListAlertsInput["types"] };

export async function listAlerts(
  ctx: MockServiceContext,
  input: ListAlertsArgs,
): Promise<AlertsSummaryDTO> {
  const allowed = visibleTypes(ctx);
  const wanted = input.types?.length ? new Set(input.types) : null;
  const types = new Set([...allowed].filter((type) => !wanted || wanted.has(type)));
  const hidden = hiddenKeys(ctx);
  const alerts = computeAlerts(ctx, types)
    .filter((alert) => !hidden.has(alert.alertKey))
    .sort(
      (a, b) =>
        (a.days ?? 0) - (b.days ?? 0) ||
        (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0) ||
        a.alertKey.localeCompare(b.alertKey),
    );
  const byType: AlertsSummaryDTO["byType"] = {};
  for (const alert of alerts) byType[alert.type] = (byType[alert.type] ?? 0) + 1;
  return { total: alerts.length, byType, items: alerts.slice(0, input.limit) };
}

function upsertDismissal(
  ctx: MockServiceContext,
  alertKey: string,
  dismissedUntil: string | null,
): AlertDismissalDTO {
  const rows = ctx.db.alertDismissals;
  const index = rows.findIndex((row) => row.userId === ctx.user.id && row.alertKey === alertKey);
  const row = { userId: ctx.user.id, alertKey, dismissedUntil, active: false };
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  return { alertKey, dismissedUntil, active: false };
}

export async function dismissAlert(
  ctx: MockServiceContext,
  input: DismissAlertInput,
): Promise<AlertDismissalDTO> {
  return upsertDismissal(ctx, input.alertKey, null);
}

export async function snoozeAlert(
  ctx: MockServiceContext,
  input: SnoozeAlertInput,
): Promise<AlertDismissalDTO> {
  const until = new Date(ctx.now.getTime() + input.days * DAY_MS).toISOString();
  return upsertDismissal(ctx, input.alertKey, until);
}

export async function restoreAlert(
  ctx: MockServiceContext,
  input: RestoreAlertInput,
): Promise<AlertDismissalDTO> {
  const rows = ctx.db.alertDismissals;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row && row.userId === ctx.user.id && row.alertKey === input.alertKey) rows.splice(i, 1);
  }
  return { alertKey: input.alertKey, dismissedUntil: null, active: true };
}
