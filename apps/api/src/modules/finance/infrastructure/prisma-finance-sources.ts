import { Injectable } from '@nestjs/common';
import {
  dbDateToDateOnly,
  decimalToString as str,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  AccountSource,
  ClientMetricsSource,
  ExpenseFactSource,
  FinanceSourceIds,
  FinanceSourcesPort,
  InstallmentCacheSource,
  InvoiceCacheSource,
  InvoiceFactSource,
  MovementFactSource,
  PaymentCacheSource,
  PaymentFactSource,
  ProjectMetricsSource,
  RecurringCacheSource,
  TransferFactSource,
} from '../application/ports/finance-sources.port';

/** Lines in a fixed order so a split with equal weights is deterministic. */
const LINE_ORDER = [{ order: 'asc' }, { id: 'asc' }] as const;

/**
 * Runs the queries one after the other: a transaction has a single connection, and `pg` deprecates
 * queries issued while another one is still executing on it.
 */
async function sequentially<T extends readonly (() => Promise<unknown>)[]>(
  queries: readonly [...T],
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** An explicit `deletedAt` key opts out of the soft-delete default filter (archived rows included). */
const INCLUDING_ARCHIVED = { deletedAt: undefined } as const;

/**
 * Reads the sources of the finance read models in the current transaction (own tables of `finance`
 * only). Takes no lock: the use case holds them (global lock order).
 */
@Injectable()
export class PrismaFinanceSources implements FinanceSourcesPort {
  constructor(private readonly host: TransactionHost) {}

  private get db() {
    return this.host.db;
  }

  async invoiceFacts(id: string): Promise<InvoiceFactSource | null> {
    const row = await this.db.invoice.findUnique({
      where: { id },
      include: {
        lines: { orderBy: [...LINE_ORDER] },
        taxLines: { orderBy: { ivaRate: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.clientId,
      status: row.status,
      isDraft: row.isDraft,
      archived: row.deletedAt !== null,
      issueDate: dbDateToDateOnly(row.issueDate),
      dueDate: dbDateToDateOnly(row.dueDate),
      usdRate: str(row.usdRate),
      totalUsd: str(row.totalUsd),
      ivaWithheld: str(row.ivaWithheld),
      islrWithheld: str(row.islrWithheld),
      otherWithheld: str(row.otherWithheld),
      lines: row.lines.map((line) => ({
        projectId: line.projectId,
        netAmount: str(line.netAmount),
      })),
      taxLines: row.taxLines.map((line) => ({
        ivaRate: str(line.ivaRate),
        ivaAmount: str(line.ivaAmount),
      })),
    };
  }

  async paymentFacts(id: string): Promise<PaymentFactSource | null> {
    const row = await this.db.payment.findUnique({
      where: { id },
      include: {
        allocations: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { invoice: { select: { lines: { orderBy: [...LINE_ORDER] } } } },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.clientId,
      accountId: row.accountId,
      methodId: row.methodId,
      date: dbDateToDateOnly(row.date),
      status: row.status,
      archived: row.deletedAt !== null,
      usdRate: str(row.usdRate),
      igtfAmount: str(row.igtfAmount),
      allocations: row.allocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        amountUsd: str(allocation.amountUsd),
        invoiceLines: allocation.invoice.lines.map((line) => ({
          projectId: line.projectId,
          netAmount: str(line.netAmount),
        })),
      })),
    };
  }

  async expenseFacts(id: string): Promise<ExpenseFactSource | null> {
    const row = await this.db.expense.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      archived: row.deletedAt !== null,
      paidDate: dbDateToDateOnly(row.paidAt ?? row.date),
      accountId: row.accountId,
      categoryId: row.categoryId,
      projectId: row.projectId,
      amountUsd: str(row.amountUsd),
    };
  }

  async transferFacts(id: string): Promise<TransferFactSource | null> {
    const row = await this.db.accountTransfer.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      archived: row.deletedAt !== null,
      date: dbDateToDateOnly(row.date),
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
      amountUsd: str(row.amountUsd),
    };
  }

  async movementFacts(id: string): Promise<MovementFactSource | null> {
    const row = await this.db.accountMovement.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      archived: row.deletedAt !== null,
      date: dbDateToDateOnly(row.date),
      accountId: row.accountId,
      type: row.type,
      amountUsd: str(row.amountUsd),
    };
  }

  async accountSource(id: string): Promise<AccountSource | null> {
    const account = await this.db.account.findUnique({ where: { id } });
    if (!account) return null;
    const [payments, expenses, transfersIn, transfersOut, movements] = await sequentially([
      () => this.db.payment.findMany({ where: { accountId: id } }),
      () => this.db.expense.findMany({ where: { accountId: id } }),
      () => this.db.accountTransfer.findMany({ where: { toAccountId: id } }),
      () => this.db.accountTransfer.findMany({ where: { fromAccountId: id } }),
      () => this.db.accountMovement.findMany({ where: { accountId: id } }),
    ]);
    return {
      id,
      activity: {
        openingBalance: str(account.openingBalance),
        payments: payments.map((payment) => ({
          date: dbDateToDateOnly(payment.date),
          netCredited: str(payment.netCredited),
          status: payment.status,
        })),
        expenses: expenses.map((expense) => ({
          date: dbDateToDateOnly(expense.paidAt ?? expense.date),
          amount: str(expense.amount),
          accountAmount: expense.accountAmount === null ? null : str(expense.accountAmount),
          status: expense.status,
        })),
        transfersIn: transfersIn.map((transfer) => ({
          date: dbDateToDateOnly(transfer.date),
          amountTo: str(transfer.amountTo),
        })),
        transfersOut: transfersOut.map((transfer) => ({
          date: dbDateToDateOnly(transfer.date),
          amountFrom: str(transfer.amountFrom),
          feeAmount: str(transfer.feeAmount),
        })),
        movements: movements.map((movement) => ({
          date: dbDateToDateOnly(movement.date),
          type: movement.type,
          amount: str(movement.amount),
        })),
      },
    };
  }

  async clientMetricsSource(clientId: string): Promise<ClientMetricsSource | null> {
    const client = await this.db.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) return null;
    const [invoices, allocations, payments] = await sequentially([
      () => this.db.invoice.findMany({ where: { clientId } }),
      () =>
        this.db.paymentAllocation.findMany({
          where: { payment: { is: { clientId, deletedAt: null } } },
          select: { amountUsd: true, payment: { select: { status: true } } },
        }),
      () => this.db.payment.findMany({ where: { clientId } }),
    ]);
    return {
      clientId,
      invoices: invoices.map((invoice) => ({
        status: invoice.status,
        isDraft: invoice.isDraft,
        totalUsd: str(invoice.totalUsd),
        balance: str(invoice.balance),
        usdRate: str(invoice.usdRate),
      })),
      allocations: allocations.map((allocation) => ({
        amountUsd: str(allocation.amountUsd),
        paymentStatus: allocation.payment.status,
      })),
      payments: payments.map((payment) => ({
        status: payment.status,
        unallocated: str(payment.unallocated),
        usdRate: str(payment.usdRate),
      })),
    };
  }

  async projectMetricsSource(projectId: string): Promise<ProjectMetricsSource | null> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) return null;
    const [plan, adjustments, lines, charges, expenses] = await sequentially([
      () => this.db.billingPlan.findUnique({ where: { projectId } }),
      () =>
        this.db.billingInstallment.findMany({
          where: { projectId, kind: 'AJUSTE', cancelledAt: null },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
      () =>
        this.db.invoiceLine.findMany({
          where: { projectId, invoice: { is: { deletedAt: null } } },
          orderBy: [{ invoiceId: 'asc' }, ...LINE_ORDER],
          include: {
            invoice: {
              select: {
                status: true,
                isDraft: true,
                usdRate: true,
                receivable: true,
                paidAmount: true,
              },
            },
          },
        }),
      () =>
        this.db.recurringCharge.findMany({
          where: { projectId, status: 'ACTIVO' },
          orderBy: { id: 'asc' },
        }),
      () =>
        this.db.expense.findMany({
          where: { projectId, status: 'PAGADO' },
          orderBy: { id: 'asc' },
        }),
    ]);
    return {
      projectId,
      plan: plan && {
        model: plan.model,
        currency: plan.currency,
        contractedUsd: plan.contractedUsd === null ? null : str(plan.contractedUsd),
        usdRate: plan.usdRate === null ? null : str(plan.usdRate),
      },
      adjustments: adjustments.map((item) => ({
        amount: str(item.amount),
        currency: item.currency,
      })),
      lines: lines.map((line) => ({
        invoiceStatus: line.invoice.status,
        invoiceIsDraft: line.invoice.isDraft,
        netAmount: str(line.netAmount),
        invoiceUsdRate: str(line.invoice.usdRate),
        invoiceReceivable: str(line.invoice.receivable),
        invoicePaid: str(line.invoice.paidAmount),
      })),
      recurringMonthlyUsd: charges.map((charge) => str(charge.monthlyAmountUsd)),
      paidExpensesUsd: expenses.map((expense) => str(expense.amountUsd)),
    };
  }

  async invoiceCache(id: string): Promise<InvoiceCacheSource | null> {
    const row = await this.db.invoice.findUnique({
      where: { id },
      include: {
        lines: { orderBy: [...LINE_ORDER] },
        taxLines: { orderBy: { ivaRate: 'asc' } },
      },
    });
    if (!row) return null;
    // Apart from the include: sibling relations are loaded in parallel, on one transaction connection.
    const allocations = await this.db.paymentAllocation.findMany({
      where: { invoiceId: id, payment: { is: { deletedAt: null } } },
      select: { amountInvoiceCurrency: true, payment: { select: { status: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      id: row.id,
      dueDate: dbDateToDateOnly(row.dueDate),
      usdRate: str(row.usdRate),
      ivaWithheld: str(row.ivaWithheld),
      islrWithheld: str(row.islrWithheld),
      otherWithheld: str(row.otherWithheld),
      isDraft: row.isDraft,
      voided: row.voidedAt !== null || row.status === 'ANULADA',
      lines: row.lines.map((line) => ({
        id: line.id,
        quantity: str(line.quantity),
        unitPrice: str(line.unitPrice),
        discount: str(line.discount),
        ivaRate: line.ivaRate === null ? null : str(line.ivaRate),
      })),
      taxLines: row.taxLines.map((line) => ({
        ivaRate: str(line.ivaRate),
        taxBase: str(line.taxBase),
        ivaAmount: str(line.ivaAmount),
      })),
      allocations: allocations.map((allocation) => ({
        amountInvoiceCurrency: str(allocation.amountInvoiceCurrency),
        paymentStatus: allocation.payment.status,
      })),
    };
  }

  async paymentCache(id: string): Promise<PaymentCacheSource | null> {
    const row = await this.db.payment.findUnique({
      where: { id },
      include: { allocations: { where: { deletedAt: null } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      amount: str(row.amount),
      igtfAmount: str(row.igtfAmount),
      feeAmount: str(row.feeAmount),
      allocated: row.allocations.map((allocation) => str(allocation.amountPaymentCurrency)),
    };
  }

  async installmentCache(id: string): Promise<InstallmentCacheSource | null> {
    const row = await this.db.billingInstallment.findUnique({ where: { id } });
    if (!row) return null;
    const invoices = await this.db.invoice.findMany({
      where: { lines: { some: { installmentId: id } } },
      select: { status: true, paidAmount: true },
    });
    return {
      id,
      cancelled: row.cancelledAt !== null,
      invoices: invoices.map((invoice) => ({
        status: invoice.status,
        paidAmount: str(invoice.paidAmount),
      })),
    };
  }

  async recurringChargeCache(id: string): Promise<RecurringCacheSource | null> {
    const row = await this.db.recurringCharge.findUnique({ where: { id } });
    return row && recurring(row);
  }

  async recurringExpenseCache(id: string): Promise<RecurringCacheSource | null> {
    const row = await this.db.recurringExpense.findUnique({ where: { id } });
    return row && recurring(row);
  }

  async allIds(): Promise<FinanceSourceIds> {
    const select = { id: true } as const;
    const orderBy = { id: 'asc' } as const;
    const [
      clients,
      projects,
      recurringCharges,
      recurringExpenses,
      installments,
      invoices,
      payments,
      expenses,
      accounts,
      transfers,
      movements,
    ] = await sequentially([
      () => this.db.client.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.project.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.recurringCharge.findMany({ select, orderBy }),
      () => this.db.recurringExpense.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.billingInstallment.findMany({ select, orderBy }),
      () => this.db.invoice.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.payment.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.expense.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.account.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.accountTransfer.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
      () => this.db.accountMovement.findMany({ where: INCLUDING_ARCHIVED, select, orderBy }),
    ]);
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    return {
      clients: ids(clients),
      projects: ids(projects),
      recurringCharges: ids(recurringCharges),
      recurringExpenses: ids(recurringExpenses),
      installments: ids(installments),
      invoices: ids(invoices),
      payments: ids(payments),
      expenses: ids(expenses),
      accounts: ids(accounts),
      transfers: ids(transfers),
      movements: ids(movements),
    };
  }
}

function recurring(row: {
  id: string;
  amount: Parameters<typeof str>[0];
  frequency: RecurringCacheSource['frequency'];
  usdRate: Parameters<typeof str>[0];
}): RecurringCacheSource {
  return {
    id: row.id,
    amount: str(row.amount),
    frequency: row.frequency,
    usdRate: str(row.usdRate),
  };
}
