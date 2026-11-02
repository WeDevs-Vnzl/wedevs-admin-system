import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../../shared/application/current-user';
import { ForbiddenError } from '../../../shared/domain/domain-error';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { PaymentListRowView } from '../application/ports/payment.repository.port';
import type { ExpenseOutput } from '../application/use-cases/expenses/expense-support';
import type { InvoiceListRowOutput } from '../application/use-cases/invoices/invoice-support';
import {
  ExpenseExportSource,
  InvoiceExportSource,
  PaymentExportSource,
} from './finance-export-sources';

const actor: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'user_1',
  role: 'ADMIN',
  email: 'a@example.test',
  name: 'Admin',
};
const query: Omit<ListQuery, 'page' | 'pageSize'> = {
  sort: { field: 'issueDate', direction: 'desc' },
  q: 'diseño',
  archived: 'exclude',
  filters: { status: ['EMITIDA', 'VENCIDA'], clientId: 'cli_a' },
};

const invoice = {
  code: 'FAC-0001',
  invoiceNumber: 'N-1',
  client: { type: 'CLIENT', id: 'cli_a', label: 'Acme' },
  projects: [
    { type: 'PROJECT', id: 'p1', label: 'Web' },
    { type: 'PROJECT', id: 'p2', label: 'App' },
  ],
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'EUR',
  total: '1234.50',
  balance: '1000.00',
  totalUsd: '1345.61',
  balanceUsd: '1090.00',
  paidAmount: '234.50',
  status: 'PARCIAL',
  daysOverdue: 0,
} as unknown as InvoiceListRowOutput;

const row = <Row>(
  source: {
    columns: Readonly<Record<string, { value: (r: Row) => unknown }>>;
  },
  id: string,
  value: Row,
) => source.columns[id]?.value(value);

describe('InvoiceExportSource', () => {
  it('reads through the invoice list with the caller, the filters and the page', async () => {
    const execute = vi.fn(async () => ({
      items: [invoice],
      total: 1,
      page: 2,
      pageSize: 100,
      pageCount: 1,
    }));
    const source = new InvoiceExportSource({ execute });

    const result = await source.read(actor, query, { page: 2, pageSize: 100 });

    expect(execute).toHaveBeenCalledWith(actor, { ...query, page: 2, pageSize: 100 });
    expect(result).toEqual({ rows: [invoice], total: 1 });
  });

  it('lets the list refusal through, so the list gate decides what the file holds', async () => {
    const source = new InvoiceExportSource({
      execute: async () => {
        throw new ForbiddenError();
      },
    });

    await expect(source.read(actor, query, { page: 1, pageSize: 100 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('writes money verbatim and types it as money', () => {
    const source = new InvoiceExportSource({ execute: async () => ({}) as never });

    expect(source.entity).toBe('INVOICE');
    for (const id of ['total', 'balance', 'totalUsd', 'balanceUsd', 'paidAmount']) {
      expect(source.columns[id]?.type).toBe('money');
    }
    expect(row(source, 'total', invoice)).toBe('1234.50');
    expect(row(source, 'client', invoice)).toBe('Acme');
    expect(row(source, 'projects', invoice)).toBe('Web; App');
    expect(row(source, 'issueDate', invoice)).toBe('2026-10-01');
    expect(source.columns.issueDate?.type).toBe('date');
    expect(source.columns.daysOverdue?.type).toBe('integer');
  });
});

describe('PaymentExportSource', () => {
  const payment = {
    code: 'PAG-0001',
    date: '2026-10-05',
    client: { type: 'CLIENT', id: 'cli_a', label: 'Acme' },
    method: { id: 'm', code: 'ZELLE', name: 'Zelle', nameEn: null },
    account: { type: 'ACCOUNT', id: 'a', label: 'Cuenta USD' },
    currency: 'USD',
    amount: '80.00',
    amountUsd: '80.00',
    allocated: '30.00',
    unallocated: '50.00',
    reference: null,
    status: 'CONFIRMADO',
  } as unknown as PaymentListRowView;

  it('reads through the payment list and maps the row cells', async () => {
    const execute = vi.fn(async () => ({
      items: [payment],
      total: 41,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    }));
    const source = new PaymentExportSource({ execute });

    expect(await source.read(actor, query, { page: 1, pageSize: 100 })).toEqual({
      rows: [payment],
      total: 41,
    });
    expect(source.entity).toBe('PAYMENT');
    expect(row(source, 'method', payment)).toBe('Zelle');
    expect(row(source, 'account', payment)).toBe('Cuenta USD');
    expect(row(source, 'unallocated', payment)).toBe('50.00');
    expect(row(source, 'reference', payment)).toBeNull();
    expect(source.columns.amountUsd?.type).toBe('money');
  });
});

describe('ExpenseExportSource', () => {
  const expense = {
    code: 'GAS-0001',
    date: '2026-10-05',
    dueDate: null,
    paidAt: null,
    description: 'Dominio',
    vendor: null,
    category: {
      id: 'c',
      name: 'Hosting',
      nameEn: null,
      parent: { id: 'p', name: 'Infraestructura', nameEn: null },
    },
    account: null,
    project: { type: 'PROJECT', id: 'p1', label: 'Web' },
    currency: 'USD',
    amount: '10.00',
    amountUsd: '10.00',
    status: 'PENDIENTE',
    recurring: true,
  } as unknown as ExpenseOutput;

  it('reads through the expense list and maps the row cells', async () => {
    const execute = vi.fn(async () => ({
      items: [expense],
      total: 1,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    }));
    const source = new ExpenseExportSource({ execute });

    expect(await source.read(actor, query, { page: 1, pageSize: 100 })).toEqual({
      rows: [expense],
      total: 1,
    });
    expect(source.entity).toBe('EXPENSE');
    expect(row(source, 'category', expense)).toBe('Infraestructura / Hosting');
    expect(row(source, 'account', expense)).toBeNull();
    expect(row(source, 'project', expense)).toBe('Web');
    expect(row(source, 'recurring', expense)).toBe(true);
    expect(source.columns.recurring?.type).toBe('boolean');
  });
});
