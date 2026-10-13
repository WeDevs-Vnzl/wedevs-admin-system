import { z } from "./zod";
import { VALIDATION_MESSAGES, dateOnlySchema, entityRefSchema } from "./common";
import { moneyDtoSchema } from "./money";
import { facetOf, timestampSchema } from "./tags";

/**
 * In-app alerts (PRD §7.9). They are computed live from queries (no job); each user can dismiss or
 * snooze them, which is stored in `AlertDismissal { userId, alertKey, dismissedUntil }` (`dismissedUntil`
 * `null` = dismissed for good). The bell shows the count and the panel; the same alerts appear on the
 * dashboard and on each module's overview.
 */

/** The nine alert types of PRD §7.9, in the order of the table. */
export const ALERT_TYPE_VALUES = [
  /** `status = VENCIDA`. */
  "INVOICE_OVERDUE",
  /** `dueDate` within 7 days and balance > 0. */
  "INVOICE_DUE_SOON",
  /** `PENDIENTE` installment due in ≤ 7 days or already due. */
  "INSTALLMENT_TO_INVOICE",
  /** `expiresAt` within the document's `alertDaysBefore` (30 by default). */
  "DOCUMENT_EXPIRING",
  /** `status = VENCIDO`. */
  "DOCUMENT_EXPIRED",
  /** Generated expense still `PENDIENTE`, due in ≤ 5 days or already due. */
  "RECURRING_EXPENSE_PENDING",
  /** Payment `PENDIENTE_VERIFICACION` older than 2 days. */
  "PAYMENT_PENDING_VERIFICATION",
  /** Confirmed payment with `unallocatedAmount > 0` older than 15 days. */
  "UNALLOCATED_CREDIT",
  /** No VES rate registered for today (business days only). */
  "MISSING_RATE",
] as const;
export const alertTypeSchema = z.enum(ALERT_TYPE_VALUES);
export type AlertType = z.infer<typeof alertTypeSchema>;

// ───────────────────────────── Alert key ─────────────────────────────

/**
 * Stable identity of an alert across recomputations: `<TYPE>:<subject>` — the entity id for entity
 * alerts (`INVOICE_OVERDUE:inv_0042`) and `VES:<YYYY-MM-DD>` for `MISSING_RATE`
 * (`MISSING_RATE:VES:2026-10-09`). Dismissals and snoozes attach to it.
 */
const ALERT_KEY_PATTERN = /^([A-Z_]+):([A-Za-z0-9_:-]{1,100})$/;

export function buildAlertKey(type: AlertType, subject: string): string {
  return `${type}:${subject}`;
}

/** Splits an alert key; `null` when it is not `<known TYPE>:<subject>`. */
export function parseAlertKey(key: string): { type: AlertType; subject: string } | null {
  const match = ALERT_KEY_PATTERN.exec(key);
  const type = alertTypeSchema.safeParse(match?.[1]);
  const subject = match?.[2];
  return type.success && subject !== undefined ? { type: type.data, subject } : null;
}

export const alertKeySchema = z
  .string()
  .max(140, VALIDATION_MESSAGES.invalidFormat)
  .refine((key) => parseAlertKey(key) !== null, { message: VALIDATION_MESSAGES.invalidFormat });
export type AlertKey = z.infer<typeof alertKeySchema>;

// ───────────────────────────── Inputs ─────────────────────────────

/** `listAlerts`: the current user's active alerts (dismissed and snoozed ones are left out). */
export const listAlertsInputSchema = z.object({
  /** Narrows to some types, e.g. a module overview's own alerts. */
  types: facetOf(alertTypeSchema),
  /** Maximum alerts returned (the bell panel shows the newest first). */
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListAlertsInput = z.infer<typeof listAlertsInputSchema>;

/** `dismissAlert`: hides the alert for good (until it is restored). */
export const dismissAlertInputSchema = z.object({ alertKey: alertKeySchema });
export type DismissAlertInput = z.infer<typeof dismissAlertInputSchema>;

/** Longest snooze offered. */
export const ALERT_MAX_SNOOZE_DAYS = 90;

/** `snoozeAlert`: hides the alert for `days` days from now (the service computes `dismissedUntil`). */
export const snoozeAlertInputSchema = z.object({
  alertKey: alertKeySchema,
  days: z.number().int().min(1).max(ALERT_MAX_SNOOZE_DAYS),
});
export type SnoozeAlertInput = z.infer<typeof snoozeAlertInputSchema>;

/** `restoreAlert`: undoes a dismissal or snooze ("Undo" in the toast). */
export const restoreAlertInputSchema = z.object({ alertKey: alertKeySchema });
export type RestoreAlertInput = z.infer<typeof restoreAlertInputSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

export const alertSchema = z.object({
  alertKey: alertKeySchema,
  type: alertTypeSchema,
  /** The record the alert is about (invoice, installment's project, document, payment…); `null` for `MISSING_RATE`. */
  entity: entityRefSchema.nullable(),
  /** Relevant date: due date, expiry date, or the day without a rate. */
  date: dateOnlySchema.nullable(),
  /** Days until (positive) or since (negative) `date`, in `America/Caracas`. */
  days: z.number().int().nullable(),
  /** Amount at stake (invoice balance, installment, payment, expense), as strings (C15). */
  amount: moneyDtoSchema.nullable(),
  /** Short context shown under the title (client name, document type…). */
  context: z.string().nullable(),
});
export type AlertDTO = z.infer<typeof alertSchema>;

/** Output of `listAlerts`: the items and the counters of the bell. */
export const alertsSummarySchema = z.object({
  /** Active alerts after dismissals and snoozes (not capped by `limit`). */
  total: z.number().int().nonnegative(),
  byType: z.partialRecord(alertTypeSchema, z.number().int().positive()),
  items: z.array(alertSchema),
});
export type AlertsSummaryDTO = z.infer<typeof alertsSummarySchema>;

/** Output of `dismissAlert`, `snoozeAlert` and `restoreAlert`. */
export const alertDismissalSchema = z.object({
  alertKey: alertKeySchema,
  /** `null` = dismissed for good; a date = snoozed until then; absent after `restoreAlert`. */
  dismissedUntil: timestampSchema.nullable(),
  active: z.boolean(),
});
export type AlertDismissalDTO = z.infer<typeof alertDismissalSchema>;

// ───────────────────────────── Services ─────────────────────────────

/**
 * Alert services (PRD §7.9; §12 does not list them). Every service is `fn(ctx, input) → Promise<DTO>`
 * (C9, C11); alerts are computed per user from `ctx.user` and `ctx.now`.
 */
export type AlertsService<Ctx = unknown> = {
  listAlerts: (ctx: Ctx, input: ListAlertsInput) => Promise<AlertsSummaryDTO>;
  dismissAlert: (ctx: Ctx, input: DismissAlertInput) => Promise<AlertDismissalDTO>;
  snoozeAlert: (ctx: Ctx, input: SnoozeAlertInput) => Promise<AlertDismissalDTO>;
  restoreAlert: (ctx: Ctx, input: RestoreAlertInput) => Promise<AlertDismissalDTO>;
};
