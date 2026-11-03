import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { diffSnapshots } from './read-models/scenario/runner';
import { stateOf, takeSnapshot } from './read-models/scenario/snapshot';
import { catalogIds, seedAccount, seedClient, seedInvoice, seedProject } from './read-models/world';
import { buildProviderPaymentWorld } from './provider-payment-int-world';
import { command } from './provider-payment-world';

/**
 * `RecordProviderPayment` and the DT-199 hooks over real PostgreSQL: the row, its provider identity, the link
 * transitions of A13 and DT-199, rollback of the event row with the payment, and the read models against a
 * from-scratch `RecomputeAll`.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let methodId: string;
let owner: CurrentUser;
const world = () => buildProviderPaymentWorld(service);

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const user = await admin.user.create({
    data: { clerkId: 'user_pp', email: 'pp@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: user.id, clerkId: user.clerkId, role: 'OWNER', email: user.email, name: 'O' };
  const setup = world();
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedProject(setup.host.db, 'pry_a', ['cli_a']);
    await seedAccount(setup.host.db, 'acc_a');
    await seedInvoice(setup.host.db, {
      id: 'inv_a',
      clientId: 'cli_a',
      lines: [{ id: 'inv_a_l', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
    });
    methodId = (await catalogIds(setup.host.db)).methodId;
  });
}, 60_000);

const delivery = (over = {}) =>
  command({ clientId: 'cli_a', accountId: 'acc_a', methodId, ...over });

const link = (over: Record<string, unknown> = {}) =>
  admin.invoicePaymentLink.create({
    data: {
      id: 'lnk_1',
      invoiceId: 'inv_a',
      requestId: '7b0f3c52-3b53-4a39-9a43-2d3f0a6b2c11',
      provider: 'STRIPE',
      externalId: 'plink_1',
      url: 'https://pay.example.test/plink_1',
      amount: '100.00',
      currency: 'USD',
      status: 'ACTIVE',
      createdById: owner.userId,
      ...over,
    },
  });

describe('recordProviderPayment over PostgreSQL', () => {
  it('writes a pending, unallocated payment with its provider identity, event row and SYSTEM entry', async () => {
    const result = await world().record.execute(SYSTEM_ACTOR, delivery());

    expect(result.outcome).toBe('RECORDED');
    const payment = await admin.payment.findFirstOrThrow({ where: { externalId: 'pi_1' } });
    expect(payment).toMatchObject({
      externalProvider: 'STRIPE',
      status: 'PENDIENTE_VERIFICACION',
      createdById: null,
      reference: 'pi_1',
    });
    expect(payment.unallocated.toFixed(2)).toBe('100.00');
    expect(payment.netCredited.toFixed(2)).toBe('96.80');
    expect(await admin.paymentAllocation.count()).toBe(0);
    expect(await admin.integrationEvent.findMany()).toEqual([
      expect.objectContaining({ eventId: 'evt_1', outcome: 'PROCESSED', entityId: payment.id }),
    ]);
    const entry = await admin.activityLog.findFirstOrThrow({
      where: { entityType: 'PAYMENT', entityId: payment.id },
    });
    expect(entry).toMatchObject({ action: 'CREATE', actorType: 'SYSTEM', actorId: null });
    expect(entry.metadata).toMatchObject({ provider: 'STRIPE', eventId: 'evt_1' });
    expect(await admin.searchEntry.count({ where: { entityType: 'PAYMENT' } })).toBe(1);
  });

  it('parks an event without a rate and writes nothing else', async () => {
    const setup = world();
    await setup.uow.run(() => seedAccount(setup.host.db, 'acc_eur', 'EUR'));

    const result = await world().record.execute(
      SYSTEM_ACTOR,
      delivery({ accountId: 'acc_eur', currency: 'EUR' }),
    );

    expect(result).toEqual({ outcome: 'PARKED', reasonCode: 'NO_RATE' });
    expect(await admin.payment.count()).toBe(0);
    expect(await admin.integrationEvent.findMany()).toEqual([
      expect.objectContaining({ outcome: 'PARKED', reasonCode: 'NO_RATE', entityId: null }),
    ]);
  });

  it('a refused reference rolls the event row back with everything else', async () => {
    await expect(
      world().record.execute(SYSTEM_ACTOR, delivery({ clientId: 'cli_ghost' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await admin.payment.count()).toBe(0);
    expect(await admin.integrationEvent.count()).toBe(0);
  });

  it('completes the ACTIVE link with the payment, in the same transaction', async () => {
    await link();

    const result = await world().record.execute(
      SYSTEM_ACTOR,
      delivery({ invoiceId: 'inv_a', linkId: 'lnk_1' }),
    );

    const stored = await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_1' } });
    expect(stored).toMatchObject({
      status: 'COMPLETED',
      paymentId: result.outcome === 'RECORDED' ? result.paymentId : null,
    });
    // The invoice balance is untouched: the payment is pending and unallocated (DT-183).
    expect(
      (await admin.invoice.findUniqueOrThrow({ where: { id: 'inv_a' } })).balance.toFixed(2),
    ).toBe('100.00');
  });

  it('a deactivated link stays as it is and the payment is still recorded (A10)', async () => {
    await link({ status: 'DEACTIVATED' });

    const result = await world().record.execute(
      SYSTEM_ACTOR,
      delivery({ invoiceId: 'inv_a', linkId: 'lnk_1' }),
    );

    expect(result.outcome).toBe('RECORDED');
    expect(
      await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_1' } }),
    ).toMatchObject({ status: 'DEACTIVATED', paymentId: null });
  });
});

describe('the DT-199 hooks over PostgreSQL', () => {
  async function completedLinkPayment() {
    await link();
    const w = world();
    const result = await w.record.execute(
      SYSTEM_ACTOR,
      delivery({ invoiceId: 'inv_a', linkId: 'lnk_1' }),
    );
    if (result.outcome !== 'RECORDED') throw new Error('expected a recorded payment');
    return { w, paymentId: result.paymentId };
  }
  const status = async () =>
    (await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_1' } })).status;

  it('allocating the payment to its invoice in full settles the link', async () => {
    const { w, paymentId } = await completedLinkPayment();
    await w.setStatusWithSettlement.execute(owner, { id: paymentId, status: 'CONFIRMADO' });
    expect(await status()).toBe('COMPLETED');

    await w.allocateWithSettlement.execute(owner, {
      paymentId,
      invoiceId: 'inv_a',
      amountPaymentCurrency: '100.00',
      amountInvoiceCurrency: '100.00',
    });

    const stored = await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_1' } });
    expect(stored.status).toBe('SETTLED');
    expect(stored.settledAt).not.toBeNull();
  });

  it('removing the allocation puts the link back to COMPLETED so its amount is reserved again', async () => {
    const { w, paymentId } = await completedLinkPayment();
    await w.setStatusWithSettlement.execute(owner, { id: paymentId, status: 'CONFIRMADO' });
    const allocated = await w.allocateWithSettlement.execute(owner, {
      paymentId,
      invoiceId: 'inv_a',
      amountPaymentCurrency: '100.00',
      amountInvoiceCurrency: '100.00',
    });
    expect(await status()).toBe('SETTLED');
    const allocationId = allocated.id;

    await w.deallocateWithSettlement.execute(owner, { allocationId });

    const stored = await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_1' } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.settledAt).toBeNull();
    expect(stored.paymentId).toBe(paymentId);
  });

  it('allocating only part of it keeps the link COMPLETED (still reserved)', async () => {
    const { w, paymentId } = await completedLinkPayment();
    await w.setStatusWithSettlement.execute(owner, { id: paymentId, status: 'CONFIRMADO' });

    await w.allocateWithSettlement.execute(owner, {
      paymentId,
      invoiceId: 'inv_a',
      amountPaymentCurrency: '40.00',
      amountInvoiceCurrency: '40.00',
    });

    expect(await status()).toBe('COMPLETED');
  });

  it('voiding the payment settles the link', async () => {
    const { w, paymentId } = await completedLinkPayment();

    await w.setStatusWithSettlement.execute(owner, { id: paymentId, status: 'ANULADO' });

    expect(await status()).toBe('SETTLED');
  });
});

describe('read models after provider payments', () => {
  it('equal a from-scratch RecomputeAll', async () => {
    const w = world();
    // The seeded invoice has no facts yet (seeding bypasses the projector): start from a rebuilt state.
    await w.recomputeAll.execute(SYSTEM_ACTOR);
    await link();
    await w.record.execute(SYSTEM_ACTOR, delivery({ invoiceId: 'inv_a', linkId: 'lnk_1' }));
    await w.record.execute(
      SYSTEM_ACTOR,
      delivery({ eventId: 'evt_2', externalId: 'pi_2', amount: '60.00', fee: null }),
    );
    const second = await admin.payment.findFirstOrThrow({ where: { externalId: 'pi_2' } });
    await w.setStatusWithSettlement.execute(owner, { id: second.id, status: 'CONFIRMADO' });
    await w.allocateWithSettlement.execute(owner, {
      paymentId: second.id,
      invoiceId: 'inv_a',
      amountPaymentCurrency: '60.00',
      amountInvoiceCurrency: '60.00',
    });
    expect(await admin.financeFact.count()).toBeGreaterThan(0);

    const incremental = await takeSnapshot(admin);
    await w.recomputeAll.execute(SYSTEM_ACTOR);
    const rebuilt = await takeSnapshot(admin);

    expect(diffSnapshots(stateOf(incremental), stateOf(rebuilt))).toEqual([]);
  });
});
