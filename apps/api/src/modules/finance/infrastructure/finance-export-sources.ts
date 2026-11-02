import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ExportColumn,
  ExportPage,
  ExportSource,
} from '../../../shared/application/ports/export-source.port';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import type { PaymentListRowView } from '../application/ports/payment.repository.port';
import type { ExpenseOutput } from '../application/use-cases/expenses/expense-support';
import type { InvoiceListRowOutput } from '../application/use-cases/invoices/invoice-support';

/** A table's list use case: the export reads through it, so its `can()` and money gates apply (DT-171). */
interface ListUseCase<Row> {
  execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<Row>>;
}

const text = <Row>(value: (row: Row) => string | null): ExportColumn<Row> => ({
  type: 'text',
  value,
});
const money = <Row>(value: (row: Row) => string): ExportColumn<Row> => ({ type: 'money', value });
const date = <Row>(value: (row: Row) => string | null): ExportColumn<Row> => ({
  type: 'date',
  value,
});

/** Pages the table's own list with the filters the caller sent; `facets` are the list's own `query.filters`. */
async function readThrough<Row>(
  list: ListUseCase<Row>,
  actor: CurrentUser,
  query: Omit<ListQuery, 'page' | 'pageSize'>,
  page: ExportPage,
): Promise<{ rows: readonly Row[]; total: number }> {
  const result = await list.execute(actor, { ...query, page: page.page, pageSize: page.pageSize });
  return { rows: result.items, total: result.total };
}

export const INVOICE_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<InvoiceListRowOutput>>> =
  {
    code: text((row) => row.code),
    invoiceNumber: text((row) => row.invoiceNumber),
    client: text((row) => row.client.label),
    projects: text((row) => row.projects.map((project) => project.label).join('; ')),
    issueDate: date((row) => row.issueDate),
    dueDate: date((row) => row.dueDate),
    currency: text((row) => row.currency),
    total: money((row) => row.total),
    balance: money((row) => row.balance),
    totalUsd: money((row) => row.totalUsd),
    balanceUsd: money((row) => row.balanceUsd),
    paidAmount: money((row) => row.paidAmount),
    status: text((row) => row.status),
    daysOverdue: { type: 'integer', value: (row) => row.daysOverdue },
  };

export const PAYMENT_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<PaymentListRowView>>> = {
  code: text((row) => row.code),
  date: date((row) => row.date),
  client: text((row) => row.client.label),
  method: text((row) => row.method.name),
  account: text((row) => row.account.label),
  currency: text((row) => row.currency),
  amount: money((row) => row.amount),
  amountUsd: money((row) => row.amountUsd),
  allocated: money((row) => row.allocated),
  unallocated: money((row) => row.unallocated),
  reference: text((row) => row.reference),
  status: text((row) => row.status),
};

export const EXPENSE_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<ExpenseOutput>>> = {
  code: text((row) => row.code),
  date: date((row) => row.date),
  dueDate: date((row) => row.dueDate),
  paidAt: date((row) => row.paidAt),
  description: text((row) => row.description),
  vendor: text((row) => row.vendor),
  category: text((row) =>
    row.category.parent ? `${row.category.parent.name} / ${row.category.name}` : row.category.name,
  ),
  account: text((row) => row.account?.label ?? null),
  project: text((row) => row.project?.label ?? null),
  currency: text((row) => row.currency),
  amount: money((row) => row.amount),
  amountUsd: money((row) => row.amountUsd),
  status: text((row) => row.status),
  recurring: { type: 'boolean', value: (row) => row.recurring },
};

export class InvoiceExportSource implements ExportSource<InvoiceListRowOutput> {
  readonly entity = 'INVOICE';
  readonly columns = INVOICE_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<InvoiceListRowOutput>) {}

  read(actor: CurrentUser, query: Omit<ListQuery, 'page' | 'pageSize'>, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}

export class PaymentExportSource implements ExportSource<PaymentListRowView> {
  readonly entity = 'PAYMENT';
  readonly columns = PAYMENT_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<PaymentListRowView>) {}

  read(actor: CurrentUser, query: Omit<ListQuery, 'page' | 'pageSize'>, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}

export class ExpenseExportSource implements ExportSource<ExpenseOutput> {
  readonly entity = 'EXPENSE';
  readonly columns = EXPENSE_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<ExpenseOutput>) {}

  read(actor: CurrentUser, query: Omit<ListQuery, 'page' | 'pageSize'>, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}
