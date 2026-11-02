import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { ClientListRow } from '../../../commercial/application/use-cases/client-support';
import type { ProjectListRowView } from '../../../commercial/application/use-cases/project-views';
import type { DocumentListRow } from '../../../documents/application/document-support';
import type { AccountOutput } from '../../../finance/application/use-cases/accounts/account-support';
import type { ExpenseOutput } from '../../../finance/application/use-cases/expenses/expense-support';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import {
  ACCOUNT_TYPE_VALUES,
  ACTIVITY_ACTION_VALUES,
  ACTOR_TYPE_VALUES,
  CLIENT_KIND_VALUES,
  CLIENT_STATUS_VALUES,
  DOCUMENT_FORMAT_VALUES,
  DOCUMENT_STATUS_VALUES,
  ENTITY_TYPE_VALUES,
  EXPENSE_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
} from '../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../shared/interface/list-query.dto';
import type { AccountsOverview } from '../../application/use-cases/overviews/get-accounts-overview.use-case';
import type { ActivityOverview } from '../../application/use-cases/overviews/get-activity-overview.use-case';
import type { ClientsOverview } from '../../application/use-cases/overviews/get-clients-overview.use-case';
import type { DocumentsOverview } from '../../application/use-cases/overviews/get-documents-overview.use-case';
import type { ExpensesOverview } from '../../application/use-cases/overviews/get-expenses-overview.use-case';
import type { InvoicesOverview } from '../../application/use-cases/overviews/get-invoices-overview.use-case';
import type { PaymentsOverview } from '../../application/use-cases/overviews/get-payments-overview.use-case';
import type { ProjectsOverview } from '../../application/use-cases/overviews/get-projects-overview.use-case';

/**
 * Responses of the module overviews (DT-174): the mock's DTO of each module, figures as decimal strings
 * (C15). A list row has the shape its module's list route answers with, declared here again because an
 * interface layer never imports another context's interface; the money gates and chips of those rows are
 * decided once, by the owner's use case.
 */

const monthKey = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const tagChip = z.object({ id: z.string(), name: z.string(), color: z.string() });
const iso = (date: Date): string => date.toISOString();
const entityRef = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});

// ───────────────────────────── Rows of the owners' lists ─────────────────────────────

const clientRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  kind: z.enum(CLIENT_KIND_VALUES),
  tradeName: z.string(),
  country: z.string(),
  status: z.enum(CLIENT_STATUS_VALUES),
  projectCount: z.number().int().nonnegative(),
  /** USD decimal string; `null` without `canSeeFinancials`. */
  totalInvoicedUsd: z.string().nullable(),
  receivableUsd: z.string().nullable(),
  tags: z.array(tagChip),
  lastActivityAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});

function toClientRow(row: ClientListRow): z.infer<typeof clientRowSchema> {
  const { client } = row;
  return {
    id: client.id,
    code: client.code,
    kind: client.kind,
    tradeName: client.tradeName,
    country: client.country,
    status: client.status,
    projectCount: row.projectCount,
    totalInvoicedUsd: row.totalInvoicedUsd,
    receivableUsd: row.receivableUsd,
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    lastActivityAt: row.lastActivityAt ? iso(row.lastActivityAt) : null,
    archivedAt: client.deletedAt ? iso(client.deletedAt) : null,
  };
}

const technologyChip = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  category: z.string(),
  iconSlug: z.string().nullable(),
  color: z.string().nullable(),
});

const projectRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  clients: z.array(
    z.object({ client: z.object(entityRefResponseSchema.shape), role: z.string().nullable() }),
  ),
  status: z.enum(PROJECT_STATUS_VALUES),
  startDate: z.string().nullable(),
  targetEndDate: z.string().nullable(),
  stack: z.array(technologyChip),
  tags: z.array(tagChip),
  archivedAt: timestampSchema.nullable(),
  /** USD decimal strings; `null` without `canSeeFinancials`. */
  contractedValueUsd: z.string().nullable(),
  invoicedUsd: z.string().nullable(),
  collectedUsd: z.string().nullable(),
  toInvoiceUsd: z.string().nullable(),
});

function toProjectRow(row: ProjectListRowView): z.infer<typeof projectRowSchema> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clients: row.clients.map((item) => ({ client: entityRef(item.client), role: item.role })),
    status: row.status,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    stack: row.stack.map((tech) => ({
      id: tech.id,
      name: tech.name,
      nameEn: tech.nameEn,
      category: tech.category,
      iconSlug: tech.iconSlug,
      color: tech.color,
    })),
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    contractedValueUsd: row.contractedValueUsd,
    invoicedUsd: row.invoicedUsd,
    collectedUsd: row.collectedUsd,
    toInvoiceUsd: row.toInvoiceUsd,
  };
}

const categoryRef = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
});
const documentRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  category: categoryRef,
  type: z.object({
    id: z.string(),
    name: z.string(),
    nameEn: z.string().nullable(),
    defaultFormat: z.enum(DOCUMENT_FORMAT_VALUES),
    requiresSignature: z.boolean(),
    hasExpiration: z.boolean(),
  }),
  status: z.enum(DOCUMENT_STATUS_VALUES),
  currentFormat: z.enum(DOCUMENT_FORMAT_VALUES).nullable(),
  currentVersionNumber: z.number().int().nullable(),
  links: z.array(z.object(entityRefResponseSchema.shape)),
  expiresAt: dateOnlySchema.nullable(),
  isShared: z.boolean(),
  tags: z.array(tagChip),
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});

function toDocumentRow(row: DocumentListRow): z.infer<typeof documentRowSchema> {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    category: {
      id: row.category.id,
      name: row.category.name,
      nameEn: row.category.nameEn,
      color: row.category.color,
    },
    type: {
      id: row.type.id,
      name: row.type.name,
      nameEn: row.type.nameEn,
      defaultFormat: row.type.defaultFormat,
      requiresSignature: row.type.requiresSignature,
      hasExpiration: row.type.hasExpiration,
    },
    status: row.status,
    currentFormat: row.currentFormat,
    currentVersionNumber: row.currentVersionNumber,
    links: row.links.map(entityRef),
    expiresAt: row.expiresAt,
    isShared: row.isShared,
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    updatedAt: iso(row.updatedAt),
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
  };
}

const optionalRef = z.object(entityRefResponseSchema.shape).nullable();
const expenseRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  date: dateOnlySchema,
  dueDate: dateOnlySchema.nullable(),
  description: z.string(),
  vendor: z.string().nullable(),
  category: z.object({
    id: idSchema,
    name: z.string(),
    nameEn: z.string().nullable(),
    parent: z.object({ id: idSchema, name: z.string(), nameEn: z.string().nullable() }).nullable(),
  }),
  account: optionalRef,
  project: optionalRef,
  currency: z.string(),
  amount: decimalStringSchema,
  amountUsd: decimalStringSchema,
  status: z.enum(EXPENSE_STATUS_VALUES),
  /** Pending and past its due date. */
  overdue: z.boolean(),
  /** Generated by a recurring expense. */
  recurring: z.boolean(),
  paidAt: dateOnlySchema.nullable(),
  accountAmount: decimalStringSchema.nullable(),
  usdRate: decimalStringSchema,
  receiptFileId: idSchema.nullable(),
  recurringExpense: optionalRef,
  periodStart: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});

function toExpenseRow(row: ExpenseOutput): z.infer<typeof expenseRowSchema> {
  const ref = (value: EntityRef | null) => (value ? entityRef(value) : null);
  return {
    id: row.id,
    code: row.code,
    date: row.date,
    dueDate: row.dueDate,
    description: row.description,
    vendor: row.vendor,
    category: row.category,
    account: ref(row.account),
    project: ref(row.project),
    currency: row.currency,
    amount: row.amount,
    amountUsd: row.amountUsd,
    status: row.status,
    overdue: row.overdue,
    recurring: row.recurring,
    paidAt: row.paidAt,
    accountAmount: row.accountAmount,
    usdRate: row.usdRate,
    receiptFileId: row.receiptFileId,
    recurringExpense: ref(row.recurringExpense),
    periodStart: row.periodStart,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

const accountCardSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: z.enum(ACCOUNT_TYPE_VALUES),
  institution: z.string().nullable(),
  currency: z.string(),
  /** Always masked; the full identifier is never stored or returned. */
  identifierMasked: z.string().nullable(),
  holderName: z.string().nullable(),
  openingBalance: decimalStringSchema,
  openingDate: dateOnlySchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  balance: decimalStringSchema,
  /** Balance in USD at today's rate; `null` while the currency has none. */
  balanceUsd: decimalStringSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

function toAccountCard(account: AccountOutput): z.infer<typeof accountCardSchema> {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    institution: account.institution,
    currency: account.currency,
    identifierMasked: account.identifierMasked,
    holderName: account.holderName,
    openingBalance: account.openingBalance,
    openingDate: account.openingDate,
    active: account.active,
    notes: account.notes,
    balance: account.balance,
    balanceUsd: account.balanceUsd,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

// ───────────────────────────── Chart pieces ─────────────────────────────

const breakdownItem = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  value: decimalStringSchema,
});
const agingBuckets = z.object({
  d0_30: decimalStringSchema,
  d31_60: decimalStringSchema,
  d61_90: decimalStringSchema,
  d90plus: decimalStringSchema,
});
const omitUndefinedLabel = <T extends { label: string | undefined }>(item: T) => {
  const { label, ...rest } = item;
  return label === undefined ? rest : { ...rest, label };
};

// ───────────────────────────── Clients ─────────────────────────────

export const clientsOverviewSchema = z.object({
  countByStatus: z.object({
    PROSPECTO: z.number().int().nonnegative(),
    ACTIVO: z.number().int().nonnegative(),
    INACTIVO: z.number().int().nonnegative(),
  }),
  /** Top 5 by collected revenue over the last 12 months; empty without `canSeeFinancials` (X15). */
  topByRevenue: z.array(clientRowSchema.extend({ collectedLast12MonthsUsd: decimalStringSchema })),
  /** Up to 10 with an overdue balance; empty without `canSeeFinancials` (X15). */
  withOverdueBalance: z.array(clientRowSchema.extend({ overdueUsd: decimalStringSchema })),
  recentlyCreated: z.array(clientRowSchema),
});
export class ClientsOverviewDto extends createZodDto(clientsOverviewSchema) {}

export function toClientsOverviewResponse(overview: ClientsOverview): ClientsOverviewDto {
  return {
    countByStatus: overview.countByStatus,
    topByRevenue: overview.topByRevenue.map((item) => ({
      ...toClientRow(item.row),
      collectedLast12MonthsUsd: item.collectedLast12MonthsUsd,
    })),
    withOverdueBalance: overview.withOverdueBalance.map((item) => ({
      ...toClientRow(item.row),
      overdueUsd: item.overdueUsd,
    })),
    recentlyCreated: overview.recentlyCreated.map(toClientRow),
  };
}

// ───────────────────────────── Projects ─────────────────────────────

export const projectsOverviewSchema = z.object({
  countByStatus: z.record(z.enum(PROJECT_STATUS_VALUES), z.number().int().nonnegative()),
  upcomingDeliveries: z.array(projectRowSchema),
  withoutBillingPlan: z.array(projectRowSchema),
  topTechnologies: z.array(
    z.object({ technology: technologyChip, projectCount: z.number().int().positive() }),
  ),
  /** Empty without `canSeeFinancials` (X15). */
  highestToInvoice: z.array(projectRowSchema),
});
export class ProjectsOverviewDto extends createZodDto(projectsOverviewSchema) {}

export function toProjectsOverviewResponse(overview: ProjectsOverview): ProjectsOverviewDto {
  return {
    countByStatus: overview.countByStatus,
    upcomingDeliveries: overview.upcomingDeliveries.map(toProjectRow),
    withoutBillingPlan: overview.withoutBillingPlan.map(toProjectRow),
    topTechnologies: overview.topTechnologies.map(({ projectCount, ...technology }) => ({
      technology,
      projectCount,
    })),
    highestToInvoice: overview.highestToInvoice.map(toProjectRow),
  };
}

// ───────────────────────────── Invoices ─────────────────────────────

export const invoicesOverviewSchema = z.object({
  /** Last 6 months, series ids `billed` and `collected` (USD). */
  billedVsCollected: z.object({
    periods: z.array(monthKey),
    series: z.array(z.object({ id: z.string(), values: z.array(decimalStringSchema) })),
  }),
  /** Open receivable in USD by days past due. */
  aging: agingBuckets,
  overdueCount: z.number().int().nonnegative(),
  totalsByCurrency: z.array(
    z.object({
      currency: z.string(),
      total: decimalStringSchema,
      balance: decimalStringSchema,
      overdue: decimalStringSchema,
    }),
  ),
});
export class InvoicesOverviewDto extends createZodDto(invoicesOverviewSchema) {}

export function toInvoicesOverviewResponse(overview: InvoicesOverview): InvoicesOverviewDto {
  return {
    billedVsCollected: {
      periods: overview.periods,
      series: [
        { id: 'billed', values: overview.billed },
        { id: 'collected', values: overview.collected },
      ],
    },
    aging: overview.aging,
    overdueCount: overview.overdueCount,
    totalsByCurrency: overview.totalsByCurrency,
  };
}

// ───────────────────────────── Payments ─────────────────────────────

export const paymentsOverviewSchema = z.object({
  /** Collected per month, last 12 months (USD, DT-98). */
  collectedByMonth: z.array(z.object({ period: monthKey, value: decimalStringSchema })),
  byMethod: z.array(breakdownItem),
  byAccount: z.array(breakdownItem),
  pendingVerificationCount: z.number().int().nonnegative(),
  unallocatedCount: z.number().int().nonnegative(),
  unallocatedTotalUsd: decimalStringSchema,
});
export class PaymentsOverviewDto extends createZodDto(paymentsOverviewSchema) {}

export function toPaymentsOverviewResponse(overview: PaymentsOverview): PaymentsOverviewDto {
  return {
    collectedByMonth: overview.collectedByMonth,
    byMethod: overview.byMethod.map(omitUndefinedLabel),
    byAccount: overview.byAccount.map(omitUndefinedLabel),
    pendingVerificationCount: overview.pendingVerificationCount,
    unallocatedCount: overview.unallocatedCount,
    unallocatedTotalUsd: overview.unallocatedTotalUsd,
  };
}

// ───────────────────────────── Expenses ─────────────────────────────

export const expensesOverviewSchema = z.object({
  /** Paid spend per month (USD), stacked by root category (series id = category id). */
  byMonthAndCategory: z.object({
    periods: z.array(monthKey),
    series: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().optional(),
        values: z.array(decimalStringSchema),
      }),
    ),
  }),
  byCategory: z.array(breakdownItem),
  /** Active recurring expenses normalised to a month (USD). */
  committedMonthly: decimalStringSchema,
  upcoming: z.array(expenseRowSchema),
});
export class ExpensesOverviewDto extends createZodDto(expensesOverviewSchema) {}

export function toExpensesOverviewResponse(overview: ExpensesOverview): ExpensesOverviewDto {
  return {
    byMonthAndCategory: {
      periods: overview.byMonthAndCategory.periods,
      series: overview.byMonthAndCategory.series.map(omitUndefinedLabel),
    },
    byCategory: overview.byCategory.map(omitUndefinedLabel),
    committedMonthly: overview.committedMonthly,
    upcoming: overview.upcoming.map(toExpenseRow),
  };
}

// ───────────────────────────── Accounts ─────────────────────────────

export const accountsOverviewSchema = z.object({
  accounts: z.array(accountCardSchema),
  /** USD total of the active accounts that have a rate. */
  totalBalanceUsd: decimalStringSchema,
});
export class AccountsOverviewDto extends createZodDto(accountsOverviewSchema) {}

export function toAccountsOverviewResponse(overview: AccountsOverview): AccountsOverviewDto {
  return {
    accounts: overview.accounts.map(toAccountCard),
    totalBalanceUsd: overview.totalBalanceUsd,
  };
}

// ───────────────────────────── Documents ─────────────────────────────

export const documentsOverviewSchema = z.object({
  byCategoryAndStatus: z.array(
    z.object({
      category: categoryRef,
      countByStatus: z.partialRecord(z.enum(DOCUMENT_STATUS_VALUES), z.number().int().positive()),
    }),
  ),
  /** Cumulative 30/60/90-day windows from today. */
  expiringCounts: z.object({
    days30: z.number().int().nonnegative(),
    days60: z.number().int().nonnegative(),
    days90: z.number().int().nonnegative(),
  }),
  expiringSoon: z.array(documentRowSchema),
  recent: z.array(documentRowSchema),
  /** Drafts with no change for more than 14 days, the oldest first. */
  staleDrafts: z.array(documentRowSchema),
});
export class DocumentsOverviewDto extends createZodDto(documentsOverviewSchema) {}

export function toDocumentsOverviewResponse(overview: DocumentsOverview): DocumentsOverviewDto {
  return {
    byCategoryAndStatus: overview.byCategoryAndStatus,
    expiringCounts: overview.expiringCounts,
    expiringSoon: overview.expiringSoon.map(toDocumentRow),
    recent: overview.recent.map(toDocumentRow),
    staleDrafts: overview.staleDrafts.map(toDocumentRow),
  };
}

// ───────────────────────────── Activity ─────────────────────────────

/** The `GET /activity` filter: `/activity/overview` is counted under the same one (X17). */
export class ActivityOverviewQueryDto extends createListQueryDto({
  sortFields: ['createdAt', 'action', 'entityType'] as const,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    actorId: idSchema,
    actorType: z.enum(ACTOR_TYPE_VALUES),
    action: z.enum(ACTIVITY_ACTION_VALUES),
    entityType: z.enum(ENTITY_TYPE_VALUES),
    entityId: idSchema,
    from: dateOnlySchema,
    to: dateOnlySchema,
  },
}) {}

export const activityOverviewSchema = z.object({
  /** Events under the filter. */
  total: z.number().int().nonnegative(),
  /** Events of the Caracas day, whatever the filter. */
  today: z.number().int().nonnegative(),
  /** Events under the filter whose actor is a user. */
  users: z.number().int().nonnegative(),
});
export class ActivityOverviewDto extends createZodDto(activityOverviewSchema) {}

export function toActivityOverviewResponse(overview: ActivityOverview): ActivityOverviewDto {
  return { total: overview.total, today: overview.today, users: overview.users };
}
