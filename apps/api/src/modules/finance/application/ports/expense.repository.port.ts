import type { DateOnly } from '../../../../shared/domain/business-date';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { ExpenseStatus } from '../../../../shared/domain/enums';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { MoneyString } from '../../../../shared/domain/money';

export const EXPENSE_REPOSITORY = Symbol('EXPENSE_REPOSITORY');

/** One `Expense` row as the use cases write it: money as decimal strings, dates as `YYYY-MM-DD`. */
export interface ExpenseRecord {
  readonly id: string;
  readonly code: string;
  readonly date: DateOnly;
  readonly dueDate: DateOnly | null;
  readonly paidAt: DateOnly | null;
  readonly description: string;
  readonly vendor: string | null;
  readonly categoryId: string;
  readonly accountId: string | null;
  readonly projectId: string | null;
  readonly currency: string;
  readonly amount: MoneyString;
  /** Debit in the account currency, only when it differs from `currency` (§9.7). */
  readonly accountAmount: MoneyString | null;
  readonly usdRate: MoneyString;
  /** USD snapshot taken at write time and never recomputed (§9.2, C16). */
  readonly amountUsd: MoneyString;
  readonly status: ExpenseStatus;
  readonly receiptFileId: string | null;
  readonly recurringExpenseId: string | null;
  readonly periodStart: DateOnly | null;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdById: string | null;
}

/** A category with its parent, so a row can show "Infraestructura → Hosting". */
export interface ExpenseCategoryView {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly parent: {
    readonly id: string;
    readonly name: string;
    readonly nameEn: string | null;
  } | null;
}

/** The expense with the labels of what it points at, for the list rows and the detail. */
export interface ExpenseView extends ExpenseRecord {
  readonly category: ExpenseCategoryView;
  readonly account: EntityRef | null;
  readonly project: EntityRef | null;
  readonly recurringExpense: EntityRef | null;
}

export interface ExpenseFilter {
  readonly q?: string;
  readonly status?: readonly ExpenseStatus[];
  /** Leaf or root category ids; a root id matches its children too. */
  readonly categoryId?: readonly string[];
  readonly accountId?: readonly string[];
  readonly projectId?: readonly string[];
  readonly currency?: readonly string[];
  readonly tagId?: readonly string[];
  readonly dateFrom?: DateOnly;
  readonly dateTo?: DateOnly;
  readonly recurringOnly?: boolean;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Access to the `Expense` table. Reads and writes run in the caller's unit of work. Expenses are never
 * archived (Q-BE3-4): they end as `ANULADO`.
 */
export interface ExpenseRepository {
  findById(id: string): Promise<ExpenseRecord | null>;
  /** Throws `VALIDATION` (`receiptFileId`) when the receipt file is already another expense's. */
  insert(record: ExpenseRecord): Promise<void>;
  update(record: ExpenseRecord): Promise<void>;
  view(id: string): Promise<ExpenseView | null>;
  list(filter: ExpenseFilter): Promise<Paginated<ExpenseView>>;
  /** Code and description of each existing expense, for the note and tag targets. */
  labels(ids: readonly string[]): Promise<Map<string, { code: string; description: string }>>;
  /** True when an expense carries the file as its receipt (the download claim of C23). */
  hasReceiptFile(fileId: string): Promise<boolean>;
}
