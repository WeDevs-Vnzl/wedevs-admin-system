import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildInvoiceWorld } from '../../../../test/finance/invoices/int-world';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedPayment,
  seedProject,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import type {
  InvoiceLineRecord,
  InvoiceRecord,
} from '../application/ports/invoice.repository.port';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const { uow, host, invoices } = buildInvoiceWorld(service);
const AT = '2026-10-09T15:00:00.000Z';

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await uow.run(async () => {
    await seedClient(host.db, 'cli_a');
    await seedClient(host.db, 'cli_b');
    await seedProject(host.db, 'pry_a', ['cli_a']);
    await host.db.billingInstallment.create({
      data: {
        id: 'ins_a',
        projectId: 'pry_a',
        kind: 'CUOTA',
        label: 'Cuota',
        amount: '100.00',
        currency: 'USD',
      },
    });
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const record = (id: string, over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id,
  code: `FAC-${id}`,
  clientId: 'cli_a',
  invoiceNumber: `N-${id}`,
  controlNumber: '00-1',
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  bcvRate: null,
  subtotal: '100.00',
  discount: '0.00',
  exemptAmount: '0.00',
  taxBase: '100.00',
  ivaAmount: '16.00',
  total: '116.00',
  ivaWithheld: '0.00',
  islrWithheld: '0.00',
  otherWithheld: '0.00',
  otherWithheldNote: null,
  receivable: '116.00',
  totalUsd: '116.00',
  receivableUsd: '116.00',
  paidAmount: '0.00',
  balance: '116.00',
  isDraft: false,
  status: 'EMITIDA',
  voidedAt: null,
  voidReason: null,
  fileId: null,
  lines: [
    {
      id: `${id}_l1`,
      order: 0,
      description: 'Servicio',
      projectId: 'pry_a',
      installmentId: 'ins_a',
      quantity: '1.00',
      unitPrice: '100.00',
      amount: '100.00',
      discount: '0.00',
      netAmount: '100.00',
      ivaRate: '16',
    },
  ],
  taxLines: [{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.00' }],
  createdAt: AT,
  updatedAt: AT,
  createdById: null,
  updatedById: null,
  archivedAt: null,
  archivedById: null,
  ...over,
});

const LINE = record('x').lines.at(0) as InvoiceLineRecord;
const insert = (rec: InvoiceRecord) => uow.run(() => invoices.insert(rec));

describe('insert, findById and update', () => {
  it('round-trips the header, lines and tax lines as decimal strings and date-only strings', async () => {
    const rec = record('inv_a', { bcvRate: '36.5', ivaWithheld: '2.00', receivable: '114.00' });
    await insert(rec);
    const loaded = await uow.run(() => invoices.findById('inv_a'));
    expect(loaded).toEqual({ ...rec, usdRate: '1', bcvRate: '36.5' });
  });

  it('update rewrites the header and replaces the lines and tax lines', async () => {
    await insert(record('inv_a'));
    const next = record('inv_a', {
      invoiceNumber: 'N-changed',
      total: '240.00',
      lines: [{ ...LINE, id: 'inv_a_l2', installmentId: null, projectId: null, ivaRate: null }],
      taxLines: [],
      archivedAt: AT,
      archivedById: null,
    });
    await uow.run(() => invoices.update(next));
    const loaded = await uow.run(() => invoices.findById('inv_a'));
    expect(loaded?.invoiceNumber).toBe('N-changed');
    expect(loaded?.lines.map((line) => line.id)).toEqual(['inv_a_l2']);
    expect(loaded?.lines[0]?.ivaRate).toBeNull();
    expect(loaded?.taxLines).toEqual([]);
    expect(loaded?.archivedAt).toBe(AT);
    expect(await admin.invoiceLine.count()).toBe(1);
  });

  it('a taken number is a CONFLICT on invoiceNumber (the partial unique index is the backstop)', async () => {
    await insert(record('inv_a', { invoiceNumber: 'DUP' }));
    await expect(insert(record('inv_b', { invoiceNumber: 'DUP' }))).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { invoiceNumber: ['invoices.errors.numberTaken'] },
    });
    // An archived holder frees the number.
    await uow.run(() => invoices.update(record('inv_a', { invoiceNumber: 'DUP', archivedAt: AT })));
    await insert(record('inv_b', { invoiceNumber: 'DUP' }));
  });

  it('a file attached to two invoices is a VALIDATION on fileId', async () => {
    const owner = await admin.user.create({
      data: { clerkId: 'u_file', email: 'f@example.test', name: 'F', role: 'OWNER' },
    });
    await admin.file.create({
      data: {
        id: 'file_a',
        storageKey: 'invoices/a.pdf',
        bucket: 'test',
        originalName: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'READY',
        uploadedById: owner.id,
      },
    });
    await insert(record('inv_a', { fileId: 'file_a' }));
    await expect(insert(record('inv_b', { fileId: 'file_a' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { fileId: ['invoices.validation.fileNotReady'] },
    });
    expect(await uow.run(() => invoices.hasFile('file_a'))).toBe(true);
    expect(await uow.run(() => invoices.hasFile('file_none'))).toBe(false);
  });
});

describe('numberHolder', () => {
  it('matches trimmed and case-insensitive, skips archived rows and the invoice itself', async () => {
    await insert(record('inv_a', { invoiceNumber: 'Kai-0001' }));
    await insert(record('inv_old', { invoiceNumber: 'OLD', archivedAt: AT }));
    expect(await uow.run(() => invoices.numberHolder(' kai-0001 ', null))).toMatchObject({
      id: 'inv_a',
      code: 'FAC-inv_a',
      invoiceNumber: 'Kai-0001',
    });
    expect(await uow.run(() => invoices.numberHolder('kai-0001', 'inv_a'))).toBeNull();
    expect(await uow.run(() => invoices.numberHolder('old', null))).toBeNull();
  });
});

describe('installments and billed amounts', () => {
  it('sums the lines of live invoices (drafts included), not voided, archived or the excluded one', async () => {
    await insert(record('inv_a'));
    await insert(
      record('inv_draft', {
        isDraft: true,
        status: 'BORRADOR',
        lines: [{ ...LINE, id: 'd_l', netAmount: '5.00' }],
      }),
    );
    await insert(
      record('inv_void', {
        status: 'ANULADA',
        voidedAt: AT,
        lines: [{ ...LINE, id: 'v_l', netAmount: '7.00' }],
      }),
    );
    await insert(
      record('inv_arch', {
        archivedAt: AT,
        lines: [{ ...LINE, id: 'r_l', netAmount: '9.00' }],
      }),
    );
    expect(await uow.run(() => invoices.billedAmounts(['ins_a'], null))).toEqual(
      new Map([['ins_a', '105.00']]),
    );
    expect(await uow.run(() => invoices.billedAmounts(['ins_a'], 'inv_a'))).toEqual(
      new Map([['ins_a', '5.00']]),
    );
    expect(await uow.run(() => invoices.installments(['ins_a', 'ins_none']))).toEqual([
      {
        id: 'ins_a',
        projectId: 'pry_a',
        label: 'Cuota',
        currency: 'USD',
        amount: '100.00',
        cancelled: false,
      },
    ]);
  });

  it('lists the PENDIENTE installments of the projects with what live invoices already bill', async () => {
    await insert(record('inv_a', { lines: [{ ...LINE, id: 'a_l', netAmount: '30.00' }] }));
    await admin.billingInstallment.create({
      data: {
        id: 'ins_done',
        projectId: 'pry_a',
        kind: 'FINAL',
        label: 'Final',
        amount: '10.00',
        currency: 'USD',
        status: 'COBRADA',
      },
    });
    const rows = await uow.run(() => invoices.billableInstallments(['pry_a']));
    expect(rows).toEqual([
      {
        installment: { type: 'INSTALLMENT', id: 'ins_a', label: 'Cuota' },
        project: { type: 'PROJECT', id: 'pry_a', code: expect.any(String), label: 'pry_a' },
        kind: 'CUOTA',
        label: 'Cuota',
        currency: 'USD',
        amount: '100.00',
        invoicedAmount: '30.00',
        dueDate: null,
      },
    ]);
    expect(await uow.run(() => invoices.billableInstallments([]))).toEqual([]);
  });
});

describe('allocations', () => {
  it('liveAllocations skips soft-deleted allocations and voided payments; view lists the same rows', async () => {
    await insert(record('inv_a'));
    const { methodId } = await uow.run(() => catalogIds(host.db));
    await uow.run(async () => {
      await seedAccount(host.db, 'acc_a');
      await seedPayment(host.db, {
        id: 'pay_ok',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '50.00',
        allocations: [
          {
            id: 'alo_ok',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '50.00',
            amountInvoiceCurrency: '50.00',
            amountUsd: '50.00',
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_pend',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '10.00',
        status: 'PENDIENTE_VERIFICACION',
        allocations: [
          {
            id: 'alo_pend',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '10.00',
            amountInvoiceCurrency: '10.00',
            amountUsd: '10.00',
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_void',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '20.00',
        status: 'ANULADO',
        allocations: [
          {
            id: 'alo_void',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '20.00',
            amountInvoiceCurrency: '20.00',
            amountUsd: '20.00',
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_del',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '30.00',
        allocations: [
          {
            id: 'alo_del',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '30.00',
            amountInvoiceCurrency: '30.00',
            amountUsd: '30.00',
            deleted: true,
          },
        ],
      });
    });
    const live = await uow.run(() => invoices.liveAllocations('inv_a'));
    expect(live.map((a) => [a.paymentId, a.amountInvoiceCurrency, a.paymentStatus]).sort()).toEqual(
      [
        ['pay_ok', '50.00', 'CONFIRMADO'],
        ['pay_pend', '10.00', 'PENDIENTE_VERIFICACION'],
      ],
    );
    const view = await uow.run(() => invoices.view('inv_a'));
    expect(view?.allocations.map((a) => a.id).sort()).toEqual(['alo_ok', 'alo_pend']);
    expect(view?.allocations[0]?.payment.type).toBe('PAYMENT');
  });
});

describe('view', () => {
  it('carries the client, the line references and the file', async () => {
    await insert(record('inv_a'));
    const view = await uow.run(() => invoices.view('inv_a'));
    expect(view?.client).toMatchObject({ type: 'CLIENT', id: 'cli_a', label: 'cli_a' });
    expect(view?.lines[0]).toMatchObject({
      project: { type: 'PROJECT', id: 'pry_a' },
      installment: { type: 'INSTALLMENT', id: 'ins_a', label: 'Cuota' },
    });
    expect(view?.file).toBeNull();
    expect(await uow.run(() => invoices.view('inv_none'))).toBeNull();
  });
});

describe('list', () => {
  const page = { page: 1, pageSize: 25 as const };
  const base = {
    archived: 'exclude' as const,
    sort: { field: 'issueDate', direction: 'desc' as const },
  };

  async function seedMany() {
    await insert(record('inv_a', { invoiceNumber: 'KAI-1', issueDate: '2026-10-01' }));
    await insert(
      record('inv_b', {
        invoiceNumber: 'ZAF-2',
        clientId: 'cli_b',
        currency: 'USD',
        issueDate: '2026-10-05',
        status: 'PAGADA',
        balance: '0.00',
        lines: [{ ...LINE, id: 'b_l', projectId: null, installmentId: null }],
      }),
    );
    await insert(
      record('inv_c', {
        invoiceNumber: 'OLD-3',
        issueDate: '2026-09-01',
        archivedAt: AT,
        lines: [],
        taxLines: [],
      }),
    );
  }

  it('excludes archived rows by default, includes or isolates them on request, and pages in SQL', async () => {
    await seedMany();
    const ids = async (extra: object) =>
      (await uow.run(() => invoices.list({ ...base, ...page, ...extra } as never))).items.map(
        (r) => r.id,
      );
    expect(await ids({})).toEqual(['inv_b', 'inv_a']);
    expect((await ids({ archived: 'include' })).sort()).toEqual(['inv_a', 'inv_b', 'inv_c']);
    expect(await ids({ archived: 'only' })).toEqual(['inv_c']);
    const paged = await uow.run(() => invoices.list({ ...base, page: 2, pageSize: 25 } as never));
    expect(paged).toMatchObject({ items: [], total: 2 });
  });

  it('filters by status, client, project, currency, issue date range and search', async () => {
    await seedMany();
    const ids = async (extra: object) =>
      (await uow.run(() => invoices.list({ ...base, ...page, ...extra } as never))).items.map(
        (r) => r.id,
      );
    expect(await ids({ status: ['PAGADA'] })).toEqual(['inv_b']);
    expect(await ids({ clientId: ['cli_a'] })).toEqual(['inv_a']);
    expect(await ids({ projectId: ['pry_a'] })).toEqual(['inv_a']);
    expect(await ids({ currency: ['VES'] })).toEqual([]);
    expect(await ids({ dateFrom: '2026-10-03', dateTo: '2026-10-31' })).toEqual(['inv_b']);
    expect(await ids({ q: 'zaf-2' })).toEqual(['inv_b']);
    expect(await ids({ q: 'FAC-inv_a' })).toEqual(['inv_a']);
  });

  it('filters by tag', async () => {
    await seedMany();
    const tag = await admin.tag.create({ data: { name: 'urgente', color: '#112233' } });
    await admin.tagAssignment.create({ data: { tagId: tag.id, invoiceId: 'inv_a' } });
    const rows = await uow.run(() => invoices.list({ ...base, ...page, tagId: [tag.id] } as never));
    expect(rows.items.map((r) => r.id)).toEqual(['inv_a']);
  });

  it('sorts by every whitelisted field, balanceUsd and daysOverdue included, with a stable tie-break', async () => {
    await seedMany();
    for (const field of [
      'code',
      'invoiceNumber',
      'issueDate',
      'dueDate',
      'total',
      'totalUsd',
      'balance',
      'balanceUsd',
      'status',
      'daysOverdue',
    ]) {
      const asc = await uow.run(() =>
        invoices.list({ ...base, ...page, sort: { field, direction: 'asc' } } as never),
      );
      const desc = await uow.run(() =>
        invoices.list({ ...base, ...page, sort: { field, direction: 'desc' } } as never),
      );
      expect(asc.items).toHaveLength(2);
      expect(desc.items).toHaveLength(2);
    }
    const byBalance = await uow.run(() =>
      invoices.list({
        ...base,
        ...page,
        sort: { field: 'balanceUsd', direction: 'desc' },
      } as never),
    );
    expect(byBalance.items.map((r) => r.id)).toEqual(['inv_a', 'inv_b']);
    const row = byBalance.items[0];
    expect(row).toMatchObject({
      balance: '116.00',
      balanceUsd: '116.00',
      total: '116.00',
      paidAmount: '0.00',
    });
    expect(row?.projects).toEqual([
      { type: 'PROJECT', id: 'pry_a', code: expect.any(String), label: 'pry_a' },
    ]);
  });

  it('lists the open invoices of a client and the overdue candidates', async () => {
    await insert(record('inv_open', { invoiceNumber: 'A', dueDate: '2026-10-01' }));
    await insert(
      record('inv_part', { invoiceNumber: 'B', status: 'PARCIAL', dueDate: '2026-12-01' }),
    );
    await insert(record('inv_paid', { invoiceNumber: 'C', status: 'PAGADA' }));
    await insert(
      record('inv_draft', {
        invoiceNumber: 'D',
        isDraft: true,
        status: 'BORRADOR',
        dueDate: '2026-01-01',
      }),
    );
    await insert(record('inv_arch', { invoiceNumber: 'E', archivedAt: AT, dueDate: '2026-01-01' }));
    expect((await uow.run(() => invoices.openInvoices('cli_a'))).map((r) => r.id)).toEqual([
      'inv_open',
      'inv_part',
    ]);
    expect(await uow.run(() => invoices.openInvoices('cli_b'))).toEqual([]);
    expect(await uow.run(() => invoices.overdueIds('2026-10-09'))).toEqual([
      'inv_arch',
      'inv_open',
    ]);
  });

  it('labels existing invoices with their client and archived flag', async () => {
    await insert(record('inv_a'));
    await insert(record('inv_arch', { invoiceNumber: 'E', archivedAt: AT }));
    const labels = await uow.run(() => invoices.labels(['inv_a', 'inv_arch', 'inv_none']));
    expect(labels.get('inv_a')).toEqual({
      id: 'inv_a',
      code: 'FAC-inv_a',
      invoiceNumber: 'N-inv_a',
      clientId: 'cli_a',
      archived: false,
    });
    expect(labels.get('inv_arch')?.archived).toBe(true);
    expect(labels.has('inv_none')).toBe(false);
  });
});
