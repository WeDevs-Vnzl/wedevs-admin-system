import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildPaymentWorld, type PaymentWorld } from '../payments/int-world';
import {
  Gate,
  catalogIds,
  gated,
  interleave,
  seedAccount,
  seedClient,
  seedInvoice,
  seedProject,
} from './world';

/**
 * Concurrent payment mutations over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first transaction is
 * paused once it wrote its source rows; the second one then runs. With the ordered locks and `Serializable` the
 * second waits and reads the committed state; without them it works on a stale read and the two commits
 * disagree (an invoice paid twice, a voided payment brought back, a lost update on an invoice). Where several
 * writers race freely the assertion is `successes + refusals = N` plus the exact state.
 * `PAYMENT_CONCURRENCY_RED=1` removes the locks and forces `ReadCommitted`: these tests must then fail.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;
let methodId: string;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: {
      clerkId: 'user_pay_conc',
      email: 'pay-conc@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  const setup = buildPaymentWorld(service);
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedProject(setup.host.db, 'pry_a', ['cli_a']);
    await seedAccount(setup.host.db, 'acc_a');
    for (const id of ['inv_a', 'inv_b']) {
      await seedInvoice(setup.host.db, {
        id,
        clientId: 'cli_a',
        lines: [{ id: `${id}_l`, projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
      });
    }
    methodId = (await catalogIds(setup.host.db)).methodId;
  });
}, 60_000);

const paymentInput = (reference: string, amount = '80.00', over: Record<string, unknown> = {}) => ({
  clientId: 'cli_a',
  date: '2026-10-05',
  accountId: 'acc_a',
  methodId,
  currency: 'USD',
  amount,
  usdRate: '1',
  reference,
  ...over,
});

const apply = (invoiceId: string, amount: string) => ({
  invoiceId,
  amountPaymentCurrency: amount,
  amountInvoiceCurrency: amount,
});

/**
 * Two worlds, the first one paused once its first fact is about to be written (it then holds whatever the use
 * case locked and has written its source rows); the second either waits for it (locks) or runs on a stale read.
 */
function twoWorlds() {
  const gate = new Gate();
  const slow = buildPaymentWorld(service, {
    writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before'),
  });
  const fast = buildPaymentWorld(service);
  return { gate, slow, fast };
}

const refusal = (result: PromiseSettledResult<unknown>) => (result as PromiseRejectedResult).reason;
const create = (world: PaymentWorld, reference: string, amount = '80.00', over = {}) =>
  world.createPayment.execute(owner, paymentInput(reference, amount, over) as never);

const invoiceRow = (id: string) => admin.invoice.findUniqueOrThrow({ where: { id } });
const liveAllocations = (where: object = {}) =>
  admin.paymentAllocation.findMany({ where: { deletedAt: null, ...where } });

describe('two allocations over one invoice balance', () => {
  it('applies 80 once: the second sees the committed balance and is refused', async () => {
    const setup = buildPaymentWorld(service);
    const first = await create(setup, 'P-1');
    const second = await create(setup, 'P-2');
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.allocate.execute(owner, { paymentId: first.id, ...apply('inv_a', '80.00') }),
      () => fast.allocate.execute(owner, { paymentId: second.id, ...apply('inv_a', '80.00') }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        'allocations.0.amountInvoiceCurrency': ['payments.validation.allocationExceedsBalance'],
      },
    });
    expect(await liveAllocations()).toHaveLength(1);
    expect(await invoiceRow('inv_a')).toMatchObject({ status: 'PARCIAL' });
    expect((await invoiceRow('inv_a')).paidAmount.toFixed(2)).toBe('80.00');
    expect((await invoiceRow('inv_a')).balance.toFixed(2)).toBe('20.00');
    const loser = await admin.payment.findUniqueOrThrow({ where: { id: second.id } });
    expect(loser.unallocated.toFixed(2)).toBe('80.00');
  });

  it('four concurrent writers: successes + refusals = 4 and the invoice is never over-paid', async () => {
    const setup = buildPaymentWorld(service);
    const payments: { id: string }[] = [];
    for (const index of [0, 1, 2, 3]) payments.push(await create(setup, `Q-${index}`, '40.00'));
    const worlds = payments.map(() => buildPaymentWorld(service));

    const results = await Promise.allSettled(
      worlds.map((world, index) =>
        world.allocate.execute(owner, {
          paymentId: (payments[index] as { id: string }).id,
          ...apply('inv_a', '40.00'),
        }),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled.length + rejected.length).toBe(4);
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length).toBeLessThanOrEqual(2);
    for (const result of rejected) {
      expect(['VALIDATION', 'CONFLICT']).toContain(refusal(result).code);
    }
    expect(await liveAllocations()).toHaveLength(fulfilled.length);
    const row = await invoiceRow('inv_a');
    expect(row.paidAmount.toFixed(2)).toBe((40 * fulfilled.length).toFixed(2));
    expect(row.balance.toFixed(2)).toBe((100 - 40 * fulfilled.length).toFixed(2));
  });
});

describe('two allocations over one payment allocatable', () => {
  it('applies 70 once: the second sees the committed credit and is refused', async () => {
    const setup = buildPaymentWorld(service);
    const payment = await create(setup, 'P-1', '100.00');
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_a', '70.00') }),
      () => fast.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_b', '70.00') }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { allocations: ['payments.validation.allocationsExceedAllocatable'] },
    });
    expect(await liveAllocations()).toHaveLength(1);
    const row = await admin.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.unallocated.toFixed(2)).toBe('30.00');
    expect((await invoiceRow('inv_b')).paidAmount.toFixed(2)).toBe('0.00');
  });
});

describe('two payments over invoices A,B and B,A', () => {
  it('neither deadlocks and the balances are exact', async () => {
    // Pending payments carry their allocations without touching the invoices; confirming both at once is the
    // concurrent write (a create would serialize on the PAG sequence row, which proves nothing about the locks).
    const setup = buildPaymentWorld(service);
    const ab = await create(setup, 'AB', '60.00', {
      status: 'PENDIENTE_VERIFICACION',
      allocations: [apply('inv_a', '30.00'), apply('inv_b', '30.00')],
    });
    const ba = await create(setup, 'BA', '40.00', {
      status: 'PENDIENTE_VERIFICACION',
      allocations: [apply('inv_b', '20.00'), apply('inv_a', '20.00')],
    });
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.setStatus.execute(owner, { id: ab.id, status: 'CONFIRMADO' }),
      () => fast.setStatus.execute(owner, { id: ba.id, status: 'CONFIRMADO' }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    for (const id of ['inv_a', 'inv_b']) {
      const row = await invoiceRow(id);
      expect(row.paidAmount.toFixed(2)).toBe('50.00');
      expect(row.balance.toFixed(2)).toBe('50.00');
      expect(row.status).toBe('PARCIAL');
    }
    expect(await liveAllocations()).toHaveLength(4);
    const collected = await admin.financeFact.aggregate({
      where: { kind: 'COLLECTED' },
      _sum: { amountUsd: true },
    });
    expect(collected._sum.amountUsd?.toFixed(2)).toBe('100.00');
  });

  it('two creates with the same allocations on A,B and B,A both succeed with exact balances', async () => {
    const worlds = [buildPaymentWorld(service), buildPaymentWorld(service)];
    const results = await Promise.allSettled([
      create(worlds[0] as PaymentWorld, 'AB', '60.00', {
        allocations: [apply('inv_a', '30.00'), apply('inv_b', '30.00')],
      }),
      create(worlds[1] as PaymentWorld, 'BA', '40.00', {
        allocations: [apply('inv_b', '20.00'), apply('inv_a', '20.00')],
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    for (const id of ['inv_a', 'inv_b']) {
      expect((await invoiceRow(id)).paidAmount.toFixed(2)).toBe('50.00');
    }
    expect(await admin.payment.count()).toBe(2);
  });
});

describe('void invoice vs allocate', () => {
  async function seedPayment() {
    const setup = buildPaymentWorld(service);
    return create(setup, 'P-1', '100.00');
  }

  it('a void in flight blocks the allocation, which then finds the invoice voided', async () => {
    const payment = await seedPayment();
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.voidInvoice.execute(owner, { id: 'inv_a', reason: 'Duplicada' }),
      () => fast.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_a', '50.00') }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'allocations.0.invoiceId': ['payments.validation.allocationInvoiceNotOpen'] },
    });
    expect((await invoiceRow('inv_a')).status).toBe('ANULADA');
    expect(await liveAllocations()).toHaveLength(0);
  });

  it('an allocation in flight blocks the void, which then finds the allocation and is refused', async () => {
    const payment = await seedPayment();
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_a', '50.00') }),
      () => fast.voidInvoice.execute(owner, { id: 'inv_a', reason: 'Duplicada' }),
    );

    expect(results[0].status).toBe('fulfilled');
    // The void plans before the allocation commits; once it holds the locks it either sees the allocation
    // (INTEGRITY_LOCK) or finds its lock set stale (CONFLICT, the invoices slice's rule). Either way it is refused.
    expect(['INTEGRITY_LOCK', 'CONFLICT']).toContain(refusal(results[1]).code);
    expect((await invoiceRow('inv_a')).status).toBe('PARCIAL');
    expect(await liveAllocations()).toHaveLength(1);
  });
});

describe('confirm vs void', () => {
  async function pending() {
    const setup = buildPaymentWorld(service);
    return create(setup, 'P-1', '100.00', {
      status: 'PENDIENTE_VERIFICACION',
      allocations: [apply('inv_a', '60.00')],
    });
  }

  it('a confirmation in flight blocks the void, which then voids the confirmed payment', async () => {
    const payment = await pending();
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.setStatus.execute(owner, { id: payment.id, status: 'CONFIRMADO' }),
      () => fast.setStatus.execute(owner, { id: payment.id, status: 'ANULADO', reason: 'Error' }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await admin.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('ANULADO');
    expect(await liveAllocations()).toHaveLength(0);
    const invoice = await invoiceRow('inv_a');
    expect(invoice.paidAmount.toFixed(2)).toBe('0.00');
    expect(invoice.status).toBe('EMITIDA');
    expect(await admin.financeFact.count({ where: { kind: 'COLLECTED' } })).toBe(0);
  });

  it('a void in flight blocks the confirmation, which then finds it voided and is refused', async () => {
    const payment = await pending();
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.setStatus.execute(owner, { id: payment.id, status: 'ANULADO' }),
      () => fast.setStatus.execute(owner, { id: payment.id, status: 'CONFIRMADO' }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'CONFLICT',
      message: 'payments.errors.voided',
    });
    const row = await admin.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('ANULADO');
    expect(row.unallocated.toFixed(2)).toBe('100.00');
    expect(await liveAllocations()).toHaveLength(0);
    expect((await invoiceRow('inv_a')).paidAmount.toFixed(2)).toBe('0.00');
  });
});

describe('the same payment and invoice twice', () => {
  it('leaves one live allocation and a CONFLICT pointing at the invoice', async () => {
    const setup = buildPaymentWorld(service);
    const payment = await create(setup, 'P-1', '100.00');
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_a', '30.00') }),
      () => fast.allocate.execute(owner, { paymentId: payment.id, ...apply('inv_a', '30.00') }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: {
        'allocations.0.invoiceId': ['payments.validation.duplicateInvoiceAllocation'],
      },
    });
    expect(await liveAllocations()).toHaveLength(1);
    expect((await invoiceRow('inv_a')).paidAmount.toFixed(2)).toBe('30.00');
  });
});
