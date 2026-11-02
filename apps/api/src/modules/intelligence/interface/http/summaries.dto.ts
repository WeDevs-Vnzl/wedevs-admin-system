import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { decimalStringSchema } from '../../../../shared/interface/common.schemas';

/** `GET /clients/{id}/summary` (`clientFinancialsSchema`): all USD snapshots as decimal strings. */
export const clientSummaryResponseSchema = z.object({
  clientId: z.string(),
  totalInvoicedUsd: decimalStringSchema,
  totalCollectedUsd: decimalStringSchema,
  receivableUsd: decimalStringSchema,
  /** The overdue part of the receivable. */
  overdueUsd: decimalStringSchema,
  /** Confirmed payments not yet allocated. */
  creditBalanceUsd: decimalStringSchema,
  projectCount: z.number().int().nonnegative(),
  /** Collected over the rolling year ending today, from `FinanceFact`. */
  collectedLast12MonthsUsd: decimalStringSchema,
});
export class ClientSummaryResponseDto extends createZodDto(clientSummaryResponseSchema) {}

/** `GET /projects/{id}/summary` (PRD §8.4.4): all USD snapshots as decimal strings. */
export const projectSummaryResponseSchema = z.object({
  projectId: z.string(),
  currency: z.literal('USD'),
  /** Contracted amount plus adjustments, never below zero. */
  contractedValue: decimalStringSchema,
  invoiced: decimalStringSchema,
  collected: decimalStringSchema,
  /** Only for fixed-price and mixed plans, else `null`. */
  toInvoice: decimalStringSchema.nullable(),
  receivable: decimalStringSchema,
  monthlyRecurring: decimalStringSchema,
  allocatedExpenses: decimalStringSchema,
  margin: decimalStringSchema,
  /** Margin ÷ collected in percent; `null` while nothing is collected. */
  marginPercent: decimalStringSchema.nullable(),
});
export class ProjectSummaryResponseDto extends createZodDto(projectSummaryResponseSchema) {}
