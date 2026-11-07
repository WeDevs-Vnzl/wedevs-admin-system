import { z } from "./zod";
import { dateOnlySchema, entityRefSchema, idSchema } from "./common";
import { percentSchema } from "./money";
import {
  agingBucketsSchema,
  kpiUnitSchema,
  monthKeySchema,
  multiSeriesSchema,
  nonNegativeDecimalSchema,
  seriesPointSchema,
  signedDecimalSchema,
  type KpiUnit,
} from "./dashboard";

/**
 * Report and KPI contracts (PRD §8.13): global filters, the ten financial reports (incl. "taxes
 * registered" with IVA **per rate**, DT-44) and the eighteen KPIs. Everything is USD from stored
 * snapshots (C16) and a decimal string (C15). Formulas live in `lib/finance`; labels live in the
 * `reports` i18n namespace, keyed by the ids below.
 */

export const REPORT_MESSAGES = {
  customRangeRequired: "reports.validation.customRangeRequired",
  rangeInverted: "reports.validation.rangeInverted",
} as const;

// ───────────────────────────── Ids ─────────────────────────────

export const REPORT_ID_VALUES = [
  "COLLECTED_BY_MONTH",
  "BILLED_VS_COLLECTED",
  "REVENUE_BY_CLIENT",
  "REVENUE_BY_PROJECT",
  "RECEIVABLES_AGING",
  "EXPENSES_BY_MONTH_CATEGORY",
  "NET_RESULT_MONTHLY",
  "ACCOUNT_FLOW",
  "COLLECTIONS_BY_METHOD",
  "TAXES_REGISTERED",
] as const;
export const reportIdSchema = z.enum(REPORT_ID_VALUES);
export type ReportId = z.infer<typeof reportIdSchema>;

export const KPI_ID_VALUES = [
  "MRR",
  "ARR",
  "DSO",
  "COLLECTION_RATE",
  "DELINQUENCY",
  "PROJECT_MARGIN",
  "OPERATING_MARGIN",
  "FIXED_MONTHLY_EXPENSE",
  "RUNWAY",
  "REVENUE_CONCENTRATION",
  "AVG_PROJECT_TICKET",
  "CLIENT_LTV",
  "NEW_CLIENTS",
  "PROSPECT_CONVERSION",
  "AVG_PROJECT_DURATION",
  "ON_TIME_PROJECTS",
  "STACK_USAGE",
  "DOCUMENT_COVERAGE",
] as const;
export const kpiIdSchema = z.enum(KPI_ID_VALUES);
export type KpiId = z.infer<typeof kpiIdSchema>;

export const KPI_UNITS: Record<KpiId, KpiUnit> = {
  MRR: "USD",
  ARR: "USD",
  DSO: "DAYS",
  COLLECTION_RATE: "PERCENT",
  DELINQUENCY: "PERCENT",
  PROJECT_MARGIN: "PERCENT",
  OPERATING_MARGIN: "PERCENT",
  FIXED_MONTHLY_EXPENSE: "USD",
  RUNWAY: "MONTHS",
  REVENUE_CONCENTRATION: "PERCENT",
  AVG_PROJECT_TICKET: "USD",
  CLIENT_LTV: "USD",
  NEW_CLIENTS: "COUNT",
  PROSPECT_CONVERSION: "PERCENT",
  AVG_PROJECT_DURATION: "DAYS",
  ON_TIME_PROJECTS: "PERCENT",
  STACK_USAGE: "COUNT",
  DOCUMENT_COVERAGE: "PERCENT",
};

// ───────────────────────────── Filters ─────────────────────────────

export const REPORT_RANGE_PRESET_VALUES = [
  "THIS_MONTH",
  "PREVIOUS_MONTH",
  "QUARTER",
  "YEAR",
  "LAST_12_MONTHS",
  "CUSTOM",
] as const;
export const reportRangePresetSchema = z.enum(REPORT_RANGE_PRESET_VALUES);
export type ReportRangePreset = z.infer<typeof reportRangePresetSchema>;

/**
 * Global filters of `/reports` (PRD §8.13): a date range (a preset or a custom one), client, project
 * and tag. `dateFrom`/`dateTo` are required and ordered only for `CUSTOM`; presets resolve to a range
 * in the service from `ctx.now` (`America/Caracas`).
 */
export const reportFilterSchema = z
  .object({
    preset: reportRangePresetSchema.default("LAST_12_MONTHS"),
    dateFrom: dateOnlySchema.optional(),
    dateTo: dateOnlySchema.optional(),
    clientId: idSchema.optional(),
    projectId: idSchema.optional(),
    tagId: idSchema.optional(),
  })
  .superRefine((filter, ctx) => {
    if (filter.preset !== "CUSTOM") return;
    for (const field of ["dateFrom", "dateTo"] as const) {
      if (filter[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: REPORT_MESSAGES.customRangeRequired,
          path: [field],
        });
      }
    }
    if (
      filter.dateFrom !== undefined &&
      filter.dateTo !== undefined &&
      filter.dateFrom > filter.dateTo
    ) {
      ctx.addIssue({ code: "custom", message: REPORT_MESSAGES.rangeInverted, path: ["dateTo"] });
    }
  });
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const getReportInputSchema = z.object({ id: reportIdSchema, filter: reportFilterSchema });
export type GetReportInput = z.infer<typeof getReportInputSchema>;

export const getKpiInputSchema = z.object({ id: kpiIdSchema, filter: reportFilterSchema });
export type GetKpiInput = z.infer<typeof getKpiInputSchema>;

// ───────────────────────────── Report results ─────────────────────────────

/** Range the report was computed for, after resolving the preset. */
export const resolvedRangeSchema = z.object({ dateFrom: dateOnlySchema, dateTo: dateOnlySchema });
export type ResolvedRange = z.infer<typeof resolvedRangeSchema>;

const reportBase = {
  currency: z.literal("USD"),
  range: resolvedRangeSchema,
};

/** IVA of one rate in one period (or in total). */
export const ivaByRateRowSchema = z.object({
  ivaRate: percentSchema,
  taxBase: nonNegativeDecimalSchema,
  ivaAmount: nonNegativeDecimalSchema,
});
export type IvaByRateRow = z.infer<typeof ivaByRateRowSchema>;

const taxesPeriodFields = {
  /** IVA billed, one row per VAT rate (`InvoiceTaxLine` grouped by rate). */
  ivaByRate: z.array(ivaByRateRowSchema),
  ivaTotal: nonNegativeDecimalSchema,
  /** Withholdings suffered by WeDevs (the client withheld them). */
  ivaWithheld: nonNegativeDecimalSchema,
  islrWithheld: nonNegativeDecimalSchema,
  otherWithheld: nonNegativeDecimalSchema,
  /** IGTF recorded on payments; informative, not income. */
  igtf: nonNegativeDecimalSchema,
};

/** "Taxes registered": informative, does not replace the accounting (PRD §8.13.1). */
export const taxesRegisteredReportSchema = z.object({
  ...reportBase,
  reportId: z.literal("TAXES_REGISTERED"),
  months: z.array(z.object({ period: monthKeySchema, ...taxesPeriodFields })),
  totals: z.object(taxesPeriodFields),
});
export type TaxesRegisteredReport = z.infer<typeof taxesRegisteredReportSchema>;

export const reportResultSchema = z.discriminatedUnion("reportId", [
  z.object({
    ...reportBase,
    reportId: z.literal("COLLECTED_BY_MONTH"),
    points: z.array(seriesPointSchema),
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("BILLED_VS_COLLECTED"),
    /** Series ids `billed` and `collected`. */
    chart: multiSeriesSchema,
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("REVENUE_BY_CLIENT"),
    rows: z.array(
      z.object({
        client: entityRefSchema,
        collected: nonNegativeDecimalSchema,
        billed: nonNegativeDecimalSchema,
      }),
    ),
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("REVENUE_BY_PROJECT"),
    rows: z.array(
      z.object({
        project: entityRefSchema,
        collected: nonNegativeDecimalSchema,
        margin: signedDecimalSchema,
        /** `null` while nothing is collected. */
        marginPercent: signedDecimalSchema.nullable(),
      }),
    ),
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("RECEIVABLES_AGING"),
    rows: z.array(
      z.object({
        client: entityRefSchema,
        buckets: agingBucketsSchema,
        total: nonNegativeDecimalSchema,
      }),
    ),
    totals: agingBucketsSchema,
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("EXPENSES_BY_MONTH_CATEGORY"),
    /** One series per category (id = category id). */
    chart: multiSeriesSchema,
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("NET_RESULT_MONTHLY"),
    /** Collected − paid expenses per month; negative values are losses. */
    points: z.array(seriesPointSchema),
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("ACCOUNT_FLOW"),
    rows: z.array(
      z.object({
        account: entityRefSchema,
        period: monthKeySchema,
        inflow: nonNegativeDecimalSchema,
        outflow: nonNegativeDecimalSchema,
      }),
    ),
  }),
  z.object({
    ...reportBase,
    reportId: z.literal("COLLECTIONS_BY_METHOD"),
    rows: z.array(
      z.object({
        methodId: idSchema,
        methodCode: z.string(),
        collected: nonNegativeDecimalSchema,
        /** Share of the total collected, 0–100. */
        share: percentSchema,
      }),
    ),
  }),
  taxesRegisteredReportSchema,
]);
export type ReportResult = z.infer<typeof reportResultSchema>;

// ───────────────────────────── KPI results ─────────────────────────────

/** KPI card of `/reports/kpis`: value, change vs the previous period and a 12-month sparkline. */
export const kpiResultDtoSchema = z.object({
  id: kpiIdSchema,
  unit: kpiUnitSchema,
  /** `null` when there is not enough data (e.g. no projects delivered yet). */
  value: signedDecimalSchema.nullable(),
  previousValue: signedDecimalSchema.nullable(),
  changePercent: signedDecimalSchema.nullable(),
  sparkline: z.array(seriesPointSchema).max(12),
  /** Detail behind the card (top clients, projects per technology…); `label` is user data. */
  breakdown: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().optional(),
        value: signedDecimalSchema,
      }),
    )
    .optional(),
});
export type KpiResultDTO = z.infer<typeof kpiResultDtoSchema>;
