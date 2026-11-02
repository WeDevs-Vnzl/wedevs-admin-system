import type { SearchIndexEntry } from '../../../shared/application/ports/search-index.port';
import type { SearchReindexSource } from '../../../shared/application/ports/search-reindex.port';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ExpenseRepository } from '../application/ports/expense.repository.port';
import type { InvoiceRepository } from '../application/ports/invoice.repository.port';
import type { PaymentRepository } from '../application/ports/payment.repository.port';
import { accountSearchEntry } from '../application/use-cases/accounts/account-support';
import { expenseSearchEntry } from '../application/use-cases/expenses/expense-support';
import { invoiceSearchEntry } from '../application/use-cases/invoices/invoice-support';
import { paymentSearchEntry } from '../application/use-cases/payments/payment-support';
import { toRecord as toAccountRecord } from './prisma-account.repository';

/**
 * An explicit `deletedAt` key opts out of the soft-delete default filter: a reindex walks archived rows too
 * (A11), so a restore never needs a backfill.
 */
const INCLUDING_ARCHIVED = { deletedAt: undefined } as const;

type IdPage = (afterId: string | null, take: number) => Promise<string[]>;

/** Ids of one table strictly after `afterId`, ascending; the page every source of this file shares. */
function pageOf(
  find: (args: {
    where: { id?: { gt: string }; deletedAt: undefined };
    select: { id: true };
    orderBy: { id: 'asc' };
    take: number;
  }) => Promise<{ id: string }[]>,
): IdPage {
  return async (afterId, take) =>
    (
      await find({
        where: { ...(afterId === null ? {} : { id: { gt: afterId } }), ...INCLUDING_ARCHIVED },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      })
    ).map((row) => row.id);
}

/** `INVOICE` entries through the builder the invoice mutations use; archived and voided invoices included. */
export class InvoiceReindexSource implements SearchReindexSource {
  readonly entityType = 'INVOICE' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly invoices: Pick<InvoiceRepository, 'view'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.invoice.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const view = await this.invoices.view(id);
    return view ? invoiceSearchEntry(view, view.client.label) : null;
  }
}

/** `PAYMENT` entries through the builder the payment mutations use. */
export class PaymentReindexSource implements SearchReindexSource {
  readonly entityType = 'PAYMENT' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly payments: Pick<PaymentRepository, 'view'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.payment.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const view = await this.payments.view(id);
    if (!view) return null;
    const row = await this.host.db.payment.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    return { ...paymentSearchEntry(view, view), archived: row?.deletedAt != null };
  }
}

/** `EXPENSE` entries through the builder the expense mutations and the recurring step use. */
export class ExpenseReindexSource implements SearchReindexSource {
  readonly entityType = 'EXPENSE' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly expenses: Pick<ExpenseRepository, 'findById'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.expense.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const record = await this.expenses.findById(id);
    if (!record) return null;
    const row = await this.host.db.expense.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    return { ...expenseSearchEntry(record), archived: row?.deletedAt != null };
  }
}

/** `ACCOUNT` entries; an archived account keeps its entry with `archived: true`. */
export class AccountReindexSource implements SearchReindexSource {
  readonly entityType = 'ACCOUNT' as const;

  constructor(private readonly host: TransactionHost) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.account.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const row = await this.host.db.account.findUnique({ where: { id } });
    if (!row) return null;
    return { ...accountSearchEntry(toAccountRecord(row)), archived: row.deletedAt !== null };
  }
}
