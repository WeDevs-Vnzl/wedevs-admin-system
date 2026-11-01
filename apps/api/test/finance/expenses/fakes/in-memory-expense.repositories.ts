import type {
  ExpenseFilter,
  ExpenseRecord,
  ExpenseRepository,
  ExpenseView,
} from '../../../../src/modules/finance/application/ports/expense.repository.port';
import type {
  RecurringExpenseFilter,
  RecurringExpenseRecord,
  RecurringExpenseRepository,
  RecurringExpenseView,
} from '../../../../src/modules/finance/application/ports/expense-recurring.repository.port';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

const category = (id: string) => ({ id, name: `cat ${id}`, nameEn: null, parent: null });

function sortRows<T extends { id: string }>(
  rows: T[],
  sort: { field: string; direction: 'asc' | 'desc' },
): T[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = String((a as Record<string, unknown>)[sort.field] ?? '');
    const y = String((b as Record<string, unknown>)[sort.field] ?? '');
    return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * sign;
  });
}

/** Fake `ExpenseRepository`: rows roll back with the unit of work like the database. */
export class InMemoryExpenseRepository implements ExpenseRepository, TransactionParticipant {
  private rows = new Map<string, ExpenseRecord>();
  private snapshot: Map<string, ExpenseRecord> | null = null;

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  get all(): readonly ExpenseRecord[] {
    return [...this.rows.values()];
  }

  seed(record: ExpenseRecord): void {
    this.rows.set(record.id, record);
  }

  async findById(id: string): Promise<ExpenseRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async insert(record: ExpenseRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async update(record: ExpenseRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  private viewOf(record: ExpenseRecord): ExpenseView {
    return {
      ...record,
      category: category(record.categoryId),
      account: record.accountId
        ? { type: 'ACCOUNT', id: record.accountId, label: `acc ${record.accountId}` }
        : null,
      project: record.projectId
        ? { type: 'PROJECT', id: record.projectId, label: `prj ${record.projectId}` }
        : null,
      recurringExpense: record.recurringExpenseId
        ? { type: 'RECURRING_EXPENSE', id: record.recurringExpenseId, label: 'schedule' }
        : null,
    };
  }

  async view(id: string): Promise<ExpenseView | null> {
    const record = this.rows.get(id);
    return record ? this.viewOf(record) : null;
  }

  async list(filter: ExpenseFilter): Promise<Paginated<ExpenseView>> {
    const matching = this.all
      .filter((row) => !filter.status || filter.status.includes(row.status))
      .filter((row) => !filter.categoryId || filter.categoryId.includes(row.categoryId))
      .filter(
        (row) => !filter.accountId || (row.accountId && filter.accountId.includes(row.accountId)),
      )
      .filter(
        (row) => !filter.projectId || (row.projectId && filter.projectId.includes(row.projectId)),
      )
      .filter((row) => !filter.currency || filter.currency.includes(row.currency))
      .filter((row) => !filter.dateFrom || row.date >= filter.dateFrom)
      .filter((row) => !filter.dateTo || row.date <= filter.dateTo)
      .filter((row) => !filter.recurringOnly || row.recurringExpenseId !== null)
      .filter((row) => {
        const needle = filter.q?.toLowerCase();
        return (
          !needle ||
          [row.code, row.description, row.vendor].some((text) =>
            text?.toLowerCase().includes(needle),
          )
        );
      });
    const sorted = sortRows([...matching], filter.sort);
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(
      sorted.slice(start, start + filter.pageSize).map((row) => this.viewOf(row)),
      sorted.length,
      filter,
    );
  }

  async labels(ids: readonly string[]) {
    const out = new Map<string, { code: string; description: string }>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) out.set(id, { code: row.code, description: row.description });
    }
    return out;
  }

  async hasReceiptFile(fileId: string): Promise<boolean> {
    return this.all.some((row) => row.receiptFileId === fileId);
  }

  begin(): void {
    this.snapshot = new Map(this.rows);
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) this.rows = this.snapshot;
    this.snapshot = null;
  }
}

/** Fake `RecurringExpenseRepository`; `expenses` is read for the generated periods. */
export class InMemoryRecurringExpenseRepository
  implements RecurringExpenseRepository, TransactionParticipant
{
  private rows = new Map<string, RecurringExpenseRecord>();
  private snapshot: Map<string, RecurringExpenseRecord> | null = null;

  constructor(
    private readonly expenses: InMemoryExpenseRepository,
    uow?: InMemoryUnitOfWork,
  ) {
    uow?.enlist(this);
  }

  get all(): readonly RecurringExpenseRecord[] {
    return [...this.rows.values()];
  }

  seed(record: RecurringExpenseRecord): void {
    this.rows.set(record.id, record);
  }

  async findById(id: string): Promise<RecurringExpenseRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async insert(record: RecurringExpenseRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async update(record: RecurringExpenseRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  private viewOf(record: RecurringExpenseRecord): RecurringExpenseView {
    return {
      ...record,
      category: category(record.categoryId),
      account: null,
      project: null,
    };
  }

  async view(id: string): Promise<RecurringExpenseView | null> {
    const record = this.rows.get(id);
    return record ? this.viewOf(record) : null;
  }

  async list(filter: RecurringExpenseFilter): Promise<Paginated<RecurringExpenseView>> {
    const matching = this.all
      .filter((row) => !filter.status || filter.status.includes(row.status))
      .filter((row) => !filter.categoryId || filter.categoryId.includes(row.categoryId))
      .filter((row) => !filter.frequency || filter.frequency.includes(row.frequency))
      .filter((row) => !filter.q || row.name.toLowerCase().includes(filter.q.toLowerCase()));
    const sorted = sortRows([...matching], filter.sort);
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(
      sorted.slice(start, start + filter.pageSize).map((row) => this.viewOf(row)),
      sorted.length,
      filter,
    );
  }

  async activeIds(): Promise<string[]> {
    return this.all
      .filter((row) => row.status === 'ACTIVO')
      .map((row) => row.id)
      .sort();
  }

  async periodsOf(ids: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const expense of this.expenses.all) {
      const periods = expense.recurringExpenseId ? out.get(expense.recurringExpenseId) : undefined;
      if (periods && expense.periodStart) periods.push(expense.periodStart);
    }
    return out;
  }

  begin(): void {
    this.snapshot = new Map(this.rows);
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) this.rows = this.snapshot;
    this.snapshot = null;
  }
}
