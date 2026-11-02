import { beforeEach, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../../identity/application/matrix-authorization';
import { InMemoryPaymentLinkSettlement } from '../../../../../../test/support/fakes/in-memory-payment-link-settlement';
import { SequentialIdGenerator } from '../../../../../../test/support/fakes/sequential-id-generator';
import { AllocatePayment } from './allocate-payment.use-case';
import {
  NOW,
  WEB,
  createPaymentsWorld,
  paymentInput,
  rejection,
  type PaymentsWorld,
} from '../../../../../../test/finance/payments/world';

let world: PaymentsWorld;

beforeEach(() => {
  world = createPaymentsWorld();
});

const draft = (paymentId: string, invoiceId: string, amount: string) => ({
  paymentId,
  invoiceId,
  amountPaymentCurrency: amount,
  amountInvoiceCurrency: amount,
});

/** A confirmed 300 USD payment with nothing applied. */
const credit300 = () => world.create.execute(world.owner, paymentInput({ amount: '300.00' }));

/** Records whether the locks of the current unit of work are held, for reads that must see a concurrent commit. */
function trackLocks(): () => boolean {
  const realLock = world.locks.lock.bind(world.locks);
  let held = false;
  world.locks.lock = async (set) => {
    await realLock(set);
    held = true;
  };
  return () => held;
}

describe('allocatePayment: a payment that changed between the read and the lock', () => {
  it('a payment that disappears after the locks is NOT_FOUND and nothing is applied', async () => {
    world.addInvoice('inv_race', '400.00', { projectId: WEB });
    const payment = await credit300();
    const held = trackLocks();
    const realFind = world.payments.findById.bind(world.payments);
    world.payments.findById = async (id) => (held() ? null : realFind(id));

    expect(
      (
        await rejection(
          world.allocate.execute(world.owner, draft(payment.id, 'inv_race', '120.00')),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(world.payments.allAllocations).toHaveLength(0);
    expect(world.activity.entries.some((entry) => entry.action === 'ALLOCATE')).toBe(false);
  });
});

describe('deallocatePayment: a row that changed between the read and the lock', () => {
  async function allocated() {
    world.addInvoice('inv_d', '400.00', { projectId: WEB });
    const payment = await credit300();
    const allocation = await world.allocate.execute(
      world.owner,
      draft(payment.id, 'inv_d', '120.00'),
    );
    world.projector.calls.length = 0;
    return { payment, allocation };
  }

  it('an allocation removed by a concurrent commit is NOT_FOUND once the lock is held', async () => {
    const { allocation } = await allocated();
    const held = trackLocks();
    const realFind = world.payments.findAllocation.bind(world.payments);
    world.payments.findAllocation = async (id) => {
      const row = await realFind(id);
      return held() && row ? { ...row, deletedAt: NOW } : row;
    };

    expect(
      (await rejection(world.deallocate.execute(world.owner, { allocationId: allocation.id })))
        .code,
    ).toBe('NOT_FOUND');
    expect(world.payments.allAllocations[0]?.deletedAt).toBeNull();
    expect(world.activity.entries.some((entry) => entry.action === 'DEALLOCATE')).toBe(false);
  });

  it('a payment that disappears after the lock is NOT_FOUND and the allocation stays live', async () => {
    const { allocation } = await allocated();
    const held = trackLocks();
    const realFind = world.payments.findById.bind(world.payments);
    world.payments.findById = async (id) => (held() ? null : realFind(id));

    expect(
      (await rejection(world.deallocate.execute(world.owner, { allocationId: allocation.id })))
        .code,
    ).toBe('NOT_FOUND');
    expect(world.payments.allAllocations[0]?.deletedAt).toBeNull();
  });

  it('removing one of two live applications keeps the other and recomputes the credit from it', async () => {
    world.addInvoice('inv_a', '400.00', { projectId: WEB });
    world.addInvoice('inv_b', '400.00', { projectId: WEB });
    const payment = await credit300();
    const first = await world.allocate.execute(world.owner, draft(payment.id, 'inv_a', '100.00'));
    const second = await world.allocate.execute(world.owner, draft(payment.id, 'inv_b', '100.00'));

    const after = await world.deallocate.execute(world.owner, { allocationId: first.id });

    expect(after).toMatchObject({ id: payment.id, allocated: '100.00', unallocated: '200.00' });
    expect(after.allocations.map((row) => row.id)).toEqual([second.id]);
    expect(await world.invoices.findById('inv_a')).toMatchObject({ balance: '400.00' });
    expect(await world.invoices.findById('inv_b')).toMatchObject({ balance: '300.00' });
  });
});

describe('allocatePayment: the payment link settlement (DT-199)', () => {
  function withSettlement() {
    const settlement = new InMemoryPaymentLinkSettlement(world.uow);
    const allocate = new AllocatePayment(
      new MatrixAuthorization(),
      world.uow,
      world.support,
      new SequentialIdGenerator('set'),
      settlement,
    );
    const link = (over = {}) => ({
      id: 'lnk_1',
      invoiceId: 'inv_link',
      amount: '120.00',
      status: 'COMPLETED' as const,
      paymentId: null as string | null,
      ...over,
    });
    return { settlement, allocate, link };
  }

  it('settles the link when the payment is allocated to its invoice in full', async () => {
    world.addInvoice('inv_link', '400.00', { projectId: WEB });
    const payment = await credit300();
    const { settlement, allocate, link } = withSettlement();
    settlement.seedLink(link({ paymentId: payment.id }));

    await allocate.execute(world.owner, draft(payment.id, 'inv_link', '120.00'));

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'SETTLED' });
    expect(settlement.link('lnk_1')?.settledAt).toBe(NOW);
  });

  it('keeps the link reserved while only part of its amount is allocated', async () => {
    world.addInvoice('inv_link', '400.00', { projectId: WEB });
    const payment = await credit300();
    const { settlement, allocate, link } = withSettlement();
    settlement.seedLink(link({ paymentId: payment.id }));

    await allocate.execute(world.owner, draft(payment.id, 'inv_link', '50.00'));

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'COMPLETED' });
  });

  it('leaves the link alone when the payment is allocated to another invoice', async () => {
    world.addInvoice('inv_link', '400.00', { projectId: WEB });
    world.addInvoice('inv_other', '400.00', { projectId: WEB });
    const payment = await credit300();
    const { settlement, allocate, link } = withSettlement();
    settlement.seedLink(link({ paymentId: payment.id }));

    await allocate.execute(world.owner, draft(payment.id, 'inv_other', '120.00'));

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'COMPLETED' });
  });

  it('a refused allocation leaves the link as it was', async () => {
    world.addInvoice('inv_link', '100.00', { projectId: WEB });
    const payment = await credit300();
    const { settlement, allocate, link } = withSettlement();
    settlement.seedLink(link({ paymentId: payment.id, amount: '200.00' }));

    await rejection(allocate.execute(world.owner, draft(payment.id, 'inv_link', '200.00')));

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'COMPLETED' });
  });
});
