import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
} from '../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../shared/interface/error-envelope';
import { KPI_ID_VALUES, KPI_UNIT_VALUES } from '../../application/use-cases/reports/kpi-catalog';
import { REPORT_RANGE_PRESET_VALUES } from '../../application/use-cases/reports/report-support';

/**
 * The filters of `/reports/*` (PRD §8.13, HU-31): a preset or a custom `from` and `to`, and a client,
 * project or tag. The use cases validate the same rules and resolve the ids, so the DTO is never the only
 * guard (C14).
 */
export const reportFilterQuerySchema = z.object({
  preset: z.enum(REPORT_RANGE_PRESET_VALUES, { message: 'reports.validation.preset' }).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  clientId: idSchema.optional(),
  projectId: idSchema.optional(),
  tagId: idSchema.optional(),
});
export class ReportFilterQueryDto extends createZodDto(reportFilterQuerySchema) {}

const money = decimalStringSchema;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const range = z.object({ dateFrom: dateOnlySchema, dateTo: dateOnlySchema });
const base = { currency: z.literal('USD'), range };

const seriesPoint = z.object({ period: month, value: money });
const chart = z.object({
  periods: z.array(month),
  series: z.array(
    z.object({ id: z.string(), label: z.string().optional(), values: z.array(money) }),
  ),
});
const agingBuckets = z.object({ d0_30: money, d31_60: money, d61_90: money, d90plus: money });
const taxesPeriod = {
  /** One row per IVA rate in percent (`"16.00"`), highest first. */
  ivaByRate: z.array(z.object({ ivaRate: money, taxBase: money, ivaAmount: money })),
  ivaTotal: money,
  /** Withholdings suffered by the studio (the client withheld them). */
  ivaWithheld: money,
  islrWithheld: money,
  otherWithheld: money,
  /** IGTF recorded on payments; informative, not income. */
  igtf: money,
};

const reportSchemas = {
  CollectedByMonthReport: z.object({
    ...base,
    reportId: z.literal('COLLECTED_BY_MONTH'),
    points: z.array(seriesPoint),
  }),
  BilledVsCollectedReport: z.object({
    ...base,
    reportId: z.literal('BILLED_VS_COLLECTED'),
    chart,
  }),
  RevenueByClientReport: z.object({
    ...base,
    reportId: z.literal('REVENUE_BY_CLIENT'),
    rows: z.array(z.object({ client: entityRefResponseSchema, collected: money, billed: money })),
  }),
  RevenueByProjectReport: z.object({
    ...base,
    reportId: z.literal('REVENUE_BY_PROJECT'),
    rows: z.array(
      z.object({
        project: entityRefResponseSchema,
        collected: money,
        /** `null` under a client filter: expense facts carry no client. */
        margin: money.nullable(),
        /** `null` while nothing is collected, and under a client filter. */
        marginPercent: money.nullable(),
      }),
    ),
  }),
  ReceivablesAgingReport: z.object({
    ...base,
    reportId: z.literal('RECEIVABLES_AGING'),
    rows: z.array(
      z.object({ client: entityRefResponseSchema, buckets: agingBuckets, total: money }),
    ),
    totals: agingBuckets,
  }),
  ExpensesByMonthCategoryReport: z.object({
    ...base,
    reportId: z.literal('EXPENSES_BY_MONTH_CATEGORY'),
    chart,
  }),
  NetResultMonthlyReport: z.object({
    ...base,
    reportId: z.literal('NET_RESULT_MONTHLY'),
    /** `value` is `null` under a client filter: expense facts carry no client. */
    points: z.array(z.object({ period: month, value: money.nullable() })),
  }),
  AccountFlowReport: z.object({
    ...base,
    reportId: z.literal('ACCOUNT_FLOW'),
    rows: z.array(
      z.object({ account: entityRefResponseSchema, period: month, inflow: money, outflow: money }),
    ),
  }),
  CollectionsByMethodReport: z.object({
    ...base,
    reportId: z.literal('COLLECTIONS_BY_METHOD'),
    rows: z.array(
      z.object({ methodId: z.string(), methodCode: z.string(), collected: money, share: money }),
    ),
  }),
  TaxesRegisteredReport: z.object({
    ...base,
    reportId: z.literal('TAXES_REGISTERED'),
    months: z.array(z.object({ period: month, ...taxesPeriod })),
    totals: z.object(taxesPeriod),
  }),
};

/**
 * The ten reports of PRD §8.13.1, discriminated by `reportId`; every amount is USD at the stored snapshot.
 * One DTO class each: a top-level union cannot be a `createZodDto` base, so the controller documents the
 * response as a `oneOf` over these.
 */
export class CollectedByMonthReportDto extends createZodDto(reportSchemas.CollectedByMonthReport) {}
export class BilledVsCollectedReportDto extends createZodDto(
  reportSchemas.BilledVsCollectedReport,
) {}
export class RevenueByClientReportDto extends createZodDto(reportSchemas.RevenueByClientReport) {}
export class RevenueByProjectReportDto extends createZodDto(reportSchemas.RevenueByProjectReport) {}
export class ReceivablesAgingReportDto extends createZodDto(reportSchemas.ReceivablesAgingReport) {}
export class ExpensesByMonthCategoryReportDto extends createZodDto(
  reportSchemas.ExpensesByMonthCategoryReport,
) {}
export class NetResultMonthlyReportDto extends createZodDto(reportSchemas.NetResultMonthlyReport) {}
export class AccountFlowReportDto extends createZodDto(reportSchemas.AccountFlowReport) {}
export class CollectionsByMethodReportDto extends createZodDto(
  reportSchemas.CollectionsByMethodReport,
) {}
export class TaxesRegisteredReportDto extends createZodDto(reportSchemas.TaxesRegisteredReport) {}

export const REPORT_RESPONSE_DTOS = [
  CollectedByMonthReportDto,
  BilledVsCollectedReportDto,
  RevenueByClientReportDto,
  RevenueByProjectReportDto,
  ReceivablesAgingReportDto,
  ExpensesByMonthCategoryReportDto,
  NetResultMonthlyReportDto,
  AccountFlowReportDto,
  CollectionsByMethodReportDto,
  TaxesRegisteredReportDto,
] as const;

const kpiCard = z.object({
  id: z.enum(KPI_ID_VALUES),
  unit: z.enum(KPI_UNIT_VALUES),
  /** `null` when there is not enough data. */
  value: money.nullable(),
  previousValue: money.nullable(),
  /** `null` when the previous value is missing or zero. */
  changePercent: money.nullable(),
  /** At most 12 months ending at the range's last month; months without data are left out. */
  sparkline: z.array(seriesPoint).max(12),
  breakdown: z
    .array(z.object({ key: z.string(), label: z.string().optional(), value: money }))
    .optional(),
});

/** `GET /reports/kpis`: the 18 cards together (PRD §8.13.2). */
export const kpisResponseSchema = z.object({
  range,
  /** The period just before, of the same length, that `previousValue` is measured over. */
  previousRange: range,
  kpis: z.array(kpiCard),
});
export class KpisResponseDto extends createZodDto(kpisResponseSchema) {}
