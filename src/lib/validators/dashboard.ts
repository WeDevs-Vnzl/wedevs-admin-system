import { z } from "./zod";
import { dateOnlySchema, entityRefSchema, idSchema } from "./common";
import { activityActionSchema } from "./enums";
import { currencyCodeSchema, moneyAmountSchema } from "./money";
import { timestampSchema } from "./catalogs";

/**
 * Dashboard contracts (PRD §8.1) and the chart primitives every overview and report reuses: month
 * keys, series, aging buckets. Every figure is USD from stored snapshots (C16) and a decimal string
 * (C15), including counts and percentages, so no `number` carries a business value.
 */

export const DASHBOARD_MESSAGES = {
  invalidMonth: "dashboard.validation.invalidMonth",
  seriesLengthMismatch: "dashboard.validation.seriesLengthMismatch",
} as const;

// ───────────────────────────── Chart primitives ─────────────────────────────

/** Signed decimal string with at most 2 decimals: balances, results, KPI values, percentages. */
export const signedDecimalSchema = moneyAmountSchema({ sign: "any" });
export const nonNegativeDecimalSchema = moneyAmountSchema({ sign: "nonNegative" });

/** `YYYY-MM` calendar month (the x axis of every monthly chart). */
export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, DASHBOARD_MESSAGES.invalidMonth);
export type MonthKey = z.infer<typeof monthKeySchema>;

export const seriesPointSchema = z.object({ period: monthKeySchema, value: signedDecimalSchema });
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

/**
 * Several series over the same periods (double bars, stacked bars). `values[i]` belongs to
 * `periods[i]`. A series `id` is a stable key (`income`, a category id…); `label` is set only for
 * user-entered names, never for UI copy (that comes from i18n by `id`).
 */
export const multiSeriesSchema = z
  .object({
    periods: z.array(monthKeySchema),
    series: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().optional(),
        values: z.array(signedDecimalSchema),
      }),
    ),
  })
  .superRefine((input, ctx) => {
    input.series.forEach((series, index) => {
      if (series.values.length !== input.periods.length) {
        ctx.addIssue({
          code: "custom",
          message: DASHBOARD_MESSAGES.seriesLengthMismatch,
          path: ["series", index, "values"],
        });
      }
    });
  });
export type MultiSeries = z.infer<typeof multiSeriesSchema>;

/** Receivables by days past due (PRD §8.5 overview, §8.13.1). */
export const agingBucketsSchema = z.object({
  d0_30: nonNegativeDecimalSchema,
  d31_60: nonNegativeDecimalSchema,
  d61_90: nonNegativeDecimalSchema,
  d90plus: nonNegativeDecimalSchema,
});
export type AgingBuckets = z.infer<typeof agingBucketsSchema>;

/** Slice of a categorical breakdown (by method, by category…). `key` is stable; `label` is user data. */
export const breakdownItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  value: nonNegativeDecimalSchema,
});
export type BreakdownItem = z.infer<typeof breakdownItemSchema>;

// ───────────────────────────── KPI cards (PRD §8.1) ─────────────────────────────

export const DASHBOARD_KPI_ID_VALUES = [
  "COLLECTED_MONTH",
  "BILLED_MONTH",
  "RECEIVABLE",
  "EXPENSES_MONTH",
  "RESULT_MONTH",
  "ACCOUNTS_BALANCE",
  "MRR",
  "ACTIVE_PROJECTS",
] as const;
export const dashboardKpiIdSchema = z.enum(DASHBOARD_KPI_ID_VALUES);
export type DashboardKpiId = z.infer<typeof dashboardKpiIdSchema>;

export const KPI_UNIT_VALUES = ["USD", "COUNT", "PERCENT", "DAYS", "MONTHS"] as const;
export const kpiUnitSchema = z.enum(KPI_UNIT_VALUES);
export type KpiUnit = z.infer<typeof kpiUnitSchema>;

export const DASHBOARD_KPI_UNITS: Record<DashboardKpiId, KpiUnit> = {
  COLLECTED_MONTH: "USD",
  BILLED_MONTH: "USD",
  RECEIVABLE: "USD",
  EXPENSES_MONTH: "USD",
  RESULT_MONTH: "USD",
  ACCOUNTS_BALANCE: "USD",
  MRR: "USD",
  ACTIVE_PROJECTS: "COUNT",
};

/** One KPI card: value, previous-period comparison and, for receivables, the overdue part. */
export const kpiCardDtoSchema = z.object({
  id: dashboardKpiIdSchema,
  unit: kpiUnitSchema,
  value: signedDecimalSchema,
  previousValue: signedDecimalSchema.nullable(),
  /** Change vs the previous period in percent; `null` when the previous value is zero or missing. */
  changePercent: signedDecimalSchema.nullable(),
  /** `RECEIVABLE`: the overdue amount shown apart. `null` for the other cards. */
  secondaryValue: signedDecimalSchema.nullable(),
});
export type KpiCardDTO = z.infer<typeof kpiCardDtoSchema>;

// ───────────────────────────── Panels ─────────────────────────────

export const dashboardInvoiceRowSchema = z.object({
  invoice: entityRefSchema,
  client: entityRefSchema,
  dueDate: dateOnlySchema,
  currency: currencyCodeSchema,
  balance: nonNegativeDecimalSchema,
  balanceUsd: nonNegativeDecimalSchema,
  /** Negative when overdue, positive when still to come. */
  daysUntilDue: z.number().int(),
});
export type DashboardInvoiceRow = z.infer<typeof dashboardInvoiceRowSchema>;

export const dashboardInstallmentRowSchema = z.object({
  installment: entityRefSchema,
  project: entityRefSchema,
  amount: signedDecimalSchema,
  currency: currencyCodeSchema,
  dueDate: dateOnlySchema.nullable(),
});
export type DashboardInstallmentRow = z.infer<typeof dashboardInstallmentRowSchema>;

export const dashboardDocumentRowSchema = z.object({
  document: entityRefSchema,
  expiresAt: dateOnlySchema,
  daysLeft: z.number().int(),
});
export type DashboardDocumentRow = z.infer<typeof dashboardDocumentRowSchema>;

export const dashboardRecurringExpenseRowSchema = z.object({
  expense: entityRefSchema,
  dueDate: dateOnlySchema,
  amount: moneyAmountSchema({ sign: "positive" }),
  currency: currencyCodeSchema,
  amountUsd: nonNegativeDecimalSchema,
});
export type DashboardRecurringExpenseRow = z.infer<typeof dashboardRecurringExpenseRowSchema>;

/** Reduced activity row; the full contract lives with the activity module. */
export const dashboardActivityRowSchema = z.object({
  id: idSchema,
  action: activityActionSchema,
  entity: entityRefSchema.nullable(),
  actorName: z.string().nullable(),
  createdAt: timestampSchema,
});
export type DashboardActivityRow = z.infer<typeof dashboardActivityRowSchema>;

// ───────────────────────────── Dashboard ─────────────────────────────

/** `month` defaults to the current business month (`America/Caracas`). */
export const dashboardQuerySchema = z.object({ month: monthKeySchema.optional() });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardDtoSchema = z.object({
  month: monthKeySchema,
  currency: z.literal("USD"),
  /** The eight cards of §8.1, in display order. */
  kpis: z.array(kpiCardDtoSchema).length(DASHBOARD_KPI_ID_VALUES.length),
  /** Last 12 months, series ids `income` and `expenses`. */
  incomeVsExpenses: multiSeriesSchema,
  /** Top 5 overdue and soon-due invoices. */
  invoicesDue: z.array(dashboardInvoiceRowSchema).max(5),
  /** Installments to invoice in the next 30 days. */
  installmentsToInvoice: z.array(dashboardInstallmentRowSchema),
  /** Documents expiring in the next 30 days. */
  documentsExpiring: z.array(dashboardDocumentRowSchema),
  upcomingRecurringExpenses: z.array(dashboardRecurringExpenseRowSchema),
  /** The last 15 events. */
  recentActivity: z.array(dashboardActivityRowSchema).max(15),
});
export type DashboardDTO = z.infer<typeof dashboardDtoSchema>;
