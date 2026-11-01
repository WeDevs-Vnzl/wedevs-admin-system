import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentRecord } from '../../../src/modules/finance/application/ports/payment.repository.port';
import {
  PaymentReceiptAccessResolver,
  PaymentNoteTargetResolver,
  PaymentTaggableResolver,
} from '../../../src/modules/finance/infrastructure/payment-registry.resolvers';
import { DEFAULT_LIST_QUERY } from '../../../src/shared/domain/list-query';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedInvoice,
  seedPayment,
  seedProject,
  seedSearchEntry,
} from '../read-models/world';
import { buildPaymentWorld, type PaymentWorld } from './int-world';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let world: PaymentWorld;
let methodId: string;
let cashId: string;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  world = buildPaymentWorld(service);
  await world.uow.run(async () => {
    const db = world.host.db;
    await seedClient(db, 'cli_a');
    await seedClient(db, 'cli_b');
    await seedProject(db, 'pry_a', ['cli_a']);
    await seedAccount(db, 'acc_a');
    await seedAccount(db, 'acc_b');
    await seedInvoice(db, {
      id: 'inv_a',
      clientId: 'cli_a',
      lines: [{ id: 'inv_a_l', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
    });
    const ids = await catalogIds(db);
    methodId = ids.methodId;
    cashId = (await db.paymentMethod.findFirstOrThrow({ where: { id: { not: methodId } } })).id;
  });
}, 60_000);

const record = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pay_1',
  code: 'PAG-0001',
  clientId: 'cli_a',
  date: '2026-10-05',
  accountId: 'acc_a',
  methodId,
  currency: 'USD',
  amount: '100.00',
  igtfAmount: '3.00',
  feeAmount: '1.50',
  netCredited: '98.50',
  allocatable: '97.00',
  unallocated: '97.00',
  usdRate: '1',
  amountUsd: '100.00',
  reference: 'OP-1',
  status: 'CONFIRMADO',
  receiptFileId: null,
  createdAt: '2026-10-09T15:00:00.000Z',
  updatedAt: '2026-10-09T15:00:00.000Z',
  createdById: null,
  updatedById: null,
  ...over,
});

const inTx = <T>(work: () => Promise<T>) => world.uow.run(work);
const allocation = (over: Record<string, unknown> = {}) => ({
  id: 'alo_1',
  paymentId: 'pay_1',
  invoiceId: 'inv_a',
  amountPaymentCurrency: '40.00',
  amountInvoiceCurrency: '40.00',
  amountUsd: '40.00',
  createdAt: '2026-10-09T15:00:00.000Z',
  createdById: null,
  deletedAt: null,
  ...over,
});

describe('PrismaPaymentRepository: rows', () => {
  it('writes and reads a payment with two-decimal strings and the rate as stored', async () => {
    await inTx(() => world.payments.insert(record()));
    // `updatedAt` is maintained by the database (`@updatedAt`), not taken from the record.
    expect(await inTx(() => world.payments.findById('pay_1'))).toEqual({
      ...record(),
      updatedAt: expect.any(String),
    });
    await inTx(() =>
      world.payments.update(record({ amount: '120.00', status: 'ANULADO', reference: null })),
    );
    expect(await inTx(() => world.payments.findById('pay_1'))).toMatchObject({
      amount: '120.00',
      status: 'ANULADO',
      reference: null,
    });
    expect(await inTx(() => world.payments.findById('pay_missing'))).toBeNull();
  });

  it('refuses a receipt file that is already another payment receipt as VALIDATION', async () => {
    const file = await admin.file.create({
      data: {
        id: 'file_1',
        storageKey: 'payments/file_1.pdf',
        bucket: 'test',
        originalName: 'r.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'READY',
        uploadedById: (
          await admin.user.create({
            data: { clerkId: 'user_repo', email: 'repo@example.test', name: 'U', role: 'OWNER' },
          })
        ).id,
      },
    });
    await inTx(() => world.payments.insert(record({ receiptFileId: file.id })));
    await expect(
      inTx(() =>
        world.payments.insert(record({ id: 'pay_2', code: 'PAG-0002', receiptFileId: file.id })),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { receiptFileId: ['payments.validation.receiptUnavailable'] },
    });
    expect(await inTx(() => world.payments.hasReceiptFile(file.id))).toBe(true);
    expect(await inTx(() => world.payments.hasReceiptFile('file_none'))).toBe(false);
  });
});

describe('PrismaPaymentRepository: allocations (soft delete, allocation_unique_active)', () => {
  beforeEach(() => inTx(() => world.payments.insert(record())));

  it('a second live allocation to the same invoice hits the unique index as CONFLICT', async () => {
    await inTx(() => world.payments.insertAllocation(allocation()));
    await expect(
      inTx(() => world.payments.insertAllocation(allocation({ id: 'alo_2' }))),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: {
        'allocations.0.invoiceId': ['payments.validation.duplicateInvoiceAllocation'],
      },
    });
    expect(await admin.paymentAllocation.count()).toBe(1);
  });

  it('rewrites the USD snapshot of a live allocation only', async () => {
    await inTx(() => world.payments.insertAllocation(allocation()));
    await inTx(() => world.payments.updateAllocationUsd('alo_1', '45.63'));
    expect((await inTx(() => world.payments.liveAllocations('pay_1')))[0]?.amountUsd).toBe('45.63');

    await inTx(() => world.payments.softDeleteAllocations(['alo_1'], '2026-10-09T16:00:00.000Z'));
    await inTx(() => world.payments.updateAllocationUsd('alo_1', '1.00'));
    expect(await inTx(() => world.payments.findAllocation('alo_1'))).toMatchObject({
      amountUsd: '45.63',
    });
  });

  it('soft-deletes: the row stays, the live list drops it and the same invoice is free again', async () => {
    await inTx(() => world.payments.insertAllocation(allocation()));
    await inTx(() => world.payments.softDeleteAllocations(['alo_1'], '2026-10-09T16:00:00.000Z'));
    await inTx(() => world.payments.softDeleteAllocations([], '2026-10-09T16:00:00.000Z'));

    expect(await inTx(() => world.payments.liveAllocations('pay_1'))).toEqual([]);
    expect(await inTx(() => world.payments.findAllocation('alo_1'))).toMatchObject({
      id: 'alo_1',
      deletedAt: '2026-10-09T16:00:00.000Z',
    });
    expect(await inTx(() => world.payments.findAllocation('alo_none'))).toBeNull();
    await inTx(() => world.payments.insertAllocation(allocation({ id: 'alo_2' })));
    const live = await inTx(() => world.payments.liveAllocations('pay_1'));
    expect(live.map((row) => row.id)).toEqual(['alo_2']);
    expect(live[0]).toMatchObject({ amountPaymentCurrency: '40.00', amountUsd: '40.00' });
    expect(await admin.paymentAllocation.count()).toBe(2);
  });

  it('rethrows an error that is not the unique index', async () => {
    await expect(
      inTx(() => world.payments.insertAllocation(allocation({ invoiceId: 'inv_missing' }))),
    ).rejects.not.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('PrismaPaymentRepository: reads', () => {
  beforeEach(async () => {
    await world.uow.run(async () => {
      const db = world.host.db;
      await seedPayment(db, {
        id: 'pay_a',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '300.00',
        date: '2026-09-01',
        allocations: [
          {
            id: 'alo_a',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '250.00',
            amountInvoiceCurrency: '250.00',
            amountUsd: '250.00',
          },
          {
            id: 'alo_gone',
            invoiceId: 'inv_a',
            amountPaymentCurrency: '9.00',
            amountInvoiceCurrency: '9.00',
            amountUsd: '9.00',
            deleted: true,
          },
        ],
      });
      await seedPayment(db, {
        id: 'pay_b',
        clientId: 'cli_b',
        accountId: 'acc_b',
        methodId: cashId,
        amount: '500.00',
        date: '2026-09-15',
        allocations: [],
        status: 'PENDIENTE_VERIFICACION',
      });
      await seedPayment(db, {
        id: 'pay_c',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '100.00',
        igtfAmount: '3.00',
        date: '2026-10-01',
        allocations: [],
      });
      await db.payment.updateMany({ where: { id: 'pay_a' }, data: { reference: 'ZL-0001' } });
      await db.payment.updateMany({ where: { id: 'pay_c' }, data: { reference: 'zl-0001' } });
      await db.payment.updateMany({ where: { id: 'pay_b' }, data: { reference: 'CASH-1' } });
      const tag = await db.tag.create({ data: { name: 'vip', color: '#ff0000' } });
      await db.tagAssignment.create({ data: { tagId: tag.id, paymentId: 'pay_c' } });
    });
  });

  const codes = async (over: Record<string, unknown> = {}) =>
    (
      await world.payments.list({
        sort: { field: 'date', direction: 'desc' },
        page: 1,
        pageSize: 25,
        ...over,
      } as never)
    ).items.map((row) => row.id);

  it('shows the detail with its labels and only the live allocations', async () => {
    const view = await inTx(() => world.payments.view('pay_a'));
    expect(view).toMatchObject({
      id: 'pay_a',
      allocated: '250.00',
      unallocated: '50.00',
      client: { type: 'CLIENT', id: 'cli_a', label: 'cli_a' },
      account: { type: 'ACCOUNT', id: 'acc_a', label: 'acc_a' },
      method: { id: methodId },
    });
    expect(view?.allocations).toHaveLength(1);
    expect(view?.allocations[0]).toMatchObject({
      id: 'alo_a',
      paymentId: 'pay_a',
      invoice: { type: 'INVOICE', id: 'inv_a' },
      invoiceCurrency: 'USD',
      amountUsd: '250.00',
    });
    expect(await inTx(() => world.payments.view('pay_none'))).toBeNull();
  });

  it('lists newest first and filters by every facet', async () => {
    expect(await codes()).toEqual(['pay_c', 'pay_b', 'pay_a']);
    expect(await codes({ status: ['PENDIENTE_VERIFICACION'] })).toEqual(['pay_b']);
    expect(await codes({ clientId: ['cli_a'] })).toEqual(['pay_c', 'pay_a']);
    expect(await codes({ accountId: ['acc_b'] })).toEqual(['pay_b']);
    expect(await codes({ methodId: [cashId] })).toEqual(['pay_b']);
    expect(await codes({ currency: ['VES'] })).toEqual([]);
    expect(await codes({ dateFrom: '2026-09-10', dateTo: '2026-09-30' })).toEqual(['pay_b']);
    expect(await codes({ hasUnallocated: true })).toEqual(['pay_c', 'pay_b', 'pay_a']);
    const tag = await admin.tag.findFirstOrThrow();
    expect(await codes({ tagId: [tag.id] })).toEqual(['pay_c']);
  });

  it('resolves q through SearchEntry: accent-folded client name, code and reference, with filters, sort and paging', async () => {
    const entry = (id: string, subtitle: string, reference: string) =>
      world.uow.run(() =>
        seedSearchEntry(world.host.db, {
          entityType: 'PAYMENT',
          entityId: id,
          code: id.toUpperCase(),
          title: reference,
          subtitle,
          body: reference,
        }),
      );
    await entry('pay_a', 'José Pérez', 'ZL-0001');
    await entry('pay_b', 'Zafiro', 'ZL-0002');
    await entry('pay_c', 'José Pérez', 'ZL-0001');
    expect(await codes({ q: 'jose' })).toEqual(['pay_c', 'pay_a']);
    expect(await codes({ q: 'ZL-0002' })).toEqual(['pay_b']);
    expect(await codes({ q: 'PAY_B' })).toEqual(['pay_b']);
    expect(await codes({ q: 'jose', clientId: ['cli_b'] })).toEqual([]);
    expect(await codes({ q: 'zl', status: ['PENDIENTE_VERIFICACION'] })).toEqual(['pay_b']);
    expect(await codes({ q: 'zl', sort: { field: 'allocated', direction: 'desc' } })).toEqual([
      'pay_a',
      'pay_b',
      'pay_c',
    ]);
    const tag = await admin.tag.findFirstOrThrow();
    expect(await codes({ q: 'jose', tagId: [tag.id] })).toEqual(['pay_c']);
    const paged = await world.uow.run(() =>
      world.payments.list({
        sort: { field: 'date', direction: 'desc' },
        q: 'zl',
        page: 2,
        pageSize: 25,
      } as never),
    );
    expect(paged).toMatchObject({ items: [], total: 3 });
  });

  it('sorts by a column, by the derived allocated amount, and pages with the total', async () => {
    expect(await codes({ sort: { field: 'amount', direction: 'asc' } })).toEqual([
      'pay_c',
      'pay_a',
      'pay_b',
    ]);
    expect(await codes({ sort: { field: 'allocated', direction: 'desc' } })).toEqual([
      'pay_a',
      'pay_b',
      'pay_c',
    ]);
    expect(await codes({ sort: { field: 'allocated', direction: 'asc' } })).toEqual([
      'pay_b',
      'pay_c',
      'pay_a',
    ]);
    const page = await world.payments.list({
      sort: { field: 'allocated', direction: 'asc' },
      page: 2,
      pageSize: 25,
      ...DEFAULT_LIST_QUERY.filters,
    } as never);
    expect(page).toMatchObject({ total: 3, page: 2, items: [] });
    const first = await world.payments.list({
      sort: { field: 'code', direction: 'asc' },
      page: 1,
      pageSize: 25,
    } as never);
    expect(first.items[0]).toMatchObject({
      id: 'pay_a',
      allocated: '250.00',
      unallocated: '50.00',
      method: { id: methodId },
      client: { id: 'cli_a' },
    });
  });

  it('finds duplicates ignoring case, voids and the excluded payment', async () => {
    const base = { methodId, accountId: 'acc_a', reference: 'ZL-0001' };
    const matches = await world.payments.duplicates(base);
    expect(matches.map((row) => row.payment.id).sort()).toEqual(['pay_a', 'pay_c']);
    expect(matches[0]?.payment).toMatchObject({ type: 'PAYMENT' });
    expect(
      (await world.payments.duplicates({ ...base, excludePaymentId: 'pay_a' })).map(
        (row) => row.payment.id,
      ),
    ).toEqual(['pay_c']);
    expect(await world.payments.duplicates({ ...base, accountId: 'acc_b' })).toEqual([]);
    await admin.payment.update({ where: { id: 'pay_c' }, data: { status: 'ANULADO' } });
    expect((await world.payments.duplicates(base)).map((row) => row.payment.id)).toEqual(['pay_a']);
  });

  it('lists the credit of confirmed payments oldest first', async () => {
    const rows = await world.payments.creditRows('cli_a');
    expect(rows.map((row) => row.paymentId)).toEqual(['pay_a', 'pay_c']);
    expect(rows[1]).toMatchObject({ unallocated: '97.00', currency: 'USD', usdRate: '1' });
    expect(await world.payments.creditRows('cli_b')).toEqual([]);
  });

  it('serves the labels the registries need', async () => {
    const labels = await world.payments.labels(['pay_a', 'pay_none']);
    expect([...labels.keys()]).toEqual(['pay_a']);

    const taggable = new PaymentTaggableResolver(world.payments);
    expect(await taggable.resolve('pay_a')).toEqual({
      label: labels.get('pay_a')?.code,
      clientId: 'cli_a',
    });
    expect(await taggable.resolve('pay_none')).toBeNull();

    const targets = await new PaymentNoteTargetResolver(world.payments).resolve([
      'pay_a',
      'pay_none',
    ]);
    expect([...targets.keys()]).toEqual(['pay_a']);
    expect(targets.get('pay_a')).toMatchObject({
      ref: { type: 'PAYMENT', id: 'pay_a' },
      archived: false,
    });

    await admin.payment.update({ where: { id: 'pay_a' }, data: { receiptFileId: null } });
    expect(await new PaymentReceiptAccessResolver(world.payments).resolve('file_none')).toBeNull();
  });
});

describe('PrismaPaymentReferences', () => {
  it('answers only for live accounts, active methods and live clients', async () => {
    expect(await inTx(() => world.references.account('acc_a'))).toEqual({
      id: 'acc_a',
      name: 'acc_a',
      currency: 'USD',
      active: true,
    });
    await admin.account.update({ where: { id: 'acc_b' }, data: { active: false } });
    expect(await inTx(() => world.references.account('acc_b'))).toMatchObject({ active: false });
    await admin.account.update({ where: { id: 'acc_b' }, data: { deletedAt: new Date() } });
    expect(await inTx(() => world.references.account('acc_b'))).toBeNull();
    expect(await inTx(() => world.references.account('acc_none'))).toBeNull();

    expect(await inTx(() => world.references.activeMethod(methodId))).toMatchObject({
      id: methodId,
    });
    await admin.paymentMethod.update({ where: { id: cashId }, data: { active: false } });
    expect(await inTx(() => world.references.activeMethod(cashId))).toBeNull();

    expect(await inTx(() => world.references.liveClient('cli_a'))).toMatchObject({
      type: 'CLIENT',
      id: 'cli_a',
    });
    expect(await inTx(() => world.references.liveClient('cli_none'))).toBeNull();
  });
});
