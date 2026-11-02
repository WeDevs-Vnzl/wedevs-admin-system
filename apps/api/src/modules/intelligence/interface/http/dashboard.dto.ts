import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { DashboardOutput } from '../../application/use-cases/dashboard/get-dashboard.use-case';
import { ACTIVITY_ACTION_VALUES } from '../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../shared/interface/error-envelope';
import {
  DASHBOARD_KPI_IDS,
  DASHBOARD_PERIOD_VALUES,
} from '../../application/use-cases/dashboard/dashboard-support';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Query of `GET /dashboard`. `month` anchors the period (its calendar quarter or year). The use case checks
 * both again, so an internal caller cannot bypass them.
 */
export const dashboardQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIOD_VALUES, { message: 'dashboard.validation.period' }).optional(),
  month: z.string().regex(MONTH, { message: 'dashboard.validation.month' }).optional(),
});
export class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}

const monthKey = z.string().regex(MONTH);

const kpiSchema = z.object({
  /** A stable key; the UI labels it by `period`. */
  id: z.enum(DASHBOARD_KPI_IDS),
  unit: z.enum(['USD', 'COUNT']),
  value: decimalStringSchema,
  /** The previous period at its own close; `null` where no history exists. */
  previousValue: decimalStringSchema.nullable(),
  changePercent: decimalStringSchema.nullable(),
  /** `RECEIVABLE`: the overdue part. */
  secondaryValue: decimalStringSchema.nullable(),
});

export const dashboardResponseSchema = z.object({
  /** The anchor month of the request. */
  month: monthKey,
  period: z.enum(DASHBOARD_PERIOD_VALUES),
  periodStart: dateOnlySchema,
  periodEnd: dateOnlySchema,
  currency: z.literal('USD'),
  /** The eight cards of §8.1, in display order. */
  kpis: z.array(kpiSchema),
  /** Twelve months ending at the month of the period's close; series `income` and `expenses`. */
  incomeVsExpenses: z.object({
    periods: z.array(monthKey),
    series: z.array(
      z.object({ id: z.enum(['income', 'expenses']), values: z.array(decimalStringSchema) }),
    ),
  }),
  /** Top 5 open invoices by due date. */
  invoicesDue: z.array(
    z.object({
      invoice: entityRefResponseSchema,
      client: entityRefResponseSchema,
      dueDate: dateOnlySchema,
      currency: z.string(),
      balance: decimalStringSchema,
      balanceUsd: decimalStringSchema,
      /** Negative when overdue. */
      daysUntilDue: z.number().int(),
    }),
  ),
  /** Installments to invoice in the next 30 days, overdue ones included. */
  installmentsToInvoice: z.array(
    z.object({
      installment: entityRefResponseSchema,
      project: entityRefResponseSchema,
      amount: decimalStringSchema,
      currency: z.string(),
      dueDate: dateOnlySchema.nullable(),
    }),
  ),
  /** Documents expiring in the next 30 days. */
  documentsExpiring: z.array(
    z.object({
      document: entityRefResponseSchema,
      expiresAt: dateOnlySchema,
      daysLeft: z.number().int(),
    }),
  ),
  /** Generated recurring expenses still pending within the next 30 days. */
  upcomingRecurringExpenses: z.array(
    z.object({
      expense: entityRefResponseSchema,
      dueDate: dateOnlySchema,
      amount: decimalStringSchema,
      currency: z.string(),
      amountUsd: decimalStringSchema,
    }),
  ),
  /** The last 15 events. */
  recentActivity: z.array(
    z.object({
      id: z.string(),
      action: z.enum(ACTIVITY_ACTION_VALUES),
      entity: entityRefResponseSchema.nullable(),
      actorName: z.string().nullable(),
      createdAt: timestampSchema,
    }),
  ),
});
export class DashboardResponseDto extends createZodDto(dashboardResponseSchema) {}

// Output mapping, shared with the MCP tool.
export const toDashboardResponse = (out: DashboardOutput): DashboardResponseDto => ({
  ...out,
  kpis: [...out.kpis],
  incomeVsExpenses: {
    periods: out.incomeVsExpenses.periods,
    series: out.incomeVsExpenses.series.map((s) => ({ id: s.id, values: s.values })),
  },
  invoicesDue: out.invoicesDue.map((row) => ({
    ...row,
    invoice: { ...row.invoice, code: row.invoice.code ?? null },
    client: { ...row.client, code: row.client.code ?? null },
  })),
  installmentsToInvoice: out.installmentsToInvoice.map((row) => ({
    ...row,
    installment: { ...row.installment, code: row.installment.code ?? null },
    project: { ...row.project, code: row.project.code ?? null },
  })),
  documentsExpiring: out.documentsExpiring.map((row) => ({
    ...row,
    document: { ...row.document, code: row.document.code ?? null },
  })),
  upcomingRecurringExpenses: out.upcomingRecurringExpenses.map((row) => ({
    ...row,
    expense: { ...row.expense, code: row.expense.code ?? null },
  })),
  recentActivity: out.recentActivity.map((row) => ({
    id: row.id,
    action: row.action as DashboardResponseDto['recentActivity'][number]['action'],
    entity: row.entity ? { ...row.entity, code: row.entity.code ?? null } : null,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
  })),
});
