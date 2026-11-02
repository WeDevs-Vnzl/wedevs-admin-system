import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FinanceClientSearchDependents } from '../../../src/modules/finance/infrastructure/client-search-dependents.adapter';
import { FinancePaymentMethodSearchDependents } from '../../../src/modules/finance/infrastructure/payment-method-search-dependents.adapter';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildPaymentWorld, type PaymentWorld } from '../payments/int-world';
import { Gate, catalogIds, gated, interleave, seedAccount, seedClient, seedProject } from './world';

/**
 * A rename rewrites the dependants' `SearchEntry` rows in its own `Serializable` unit of work (DT-166, X18). The
 * rename flows of `commercial` and `settings` bind these adapters in step B; here a unit of work with the same
 * shape (the client row locked first for a client, no lock for a method) races the invoice and payment flows.
 * The first transaction is paused (`Gate`); the second one then runs. Either order must end with the new label
 * in the entry, and the loser retries or answers `CONFLICT`, never a 500.
 * `SEARCH_DEPENDENTS_CONCURRENCY_RED=1` runs the renames at `ReadCommitted` without the client lock, as
 * `UpdatePaymentMethod` does today: these tests must then fail (observed RED, lesson B3).
 */
const RED = process.env.SEARCH_DEPENDENTS_CONCURRENCY_RED === '1';
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
      clerkId: 'user_dep_conc',
      email: 'dep-conc@example.test',
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
    methodId = (await catalogIds(setup.host.db)).methodId;
  });
}, 60_000);

const invoiceInput = (invoiceNumber: string) => ({
  clientId: 'cli_a',
  invoiceNumber,
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  lines: [{ description: 'Servicio', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
});
const paymentInput = (reference: string) => ({
  clientId: 'cli_a',
  date: '2026-10-05',
  accountId: 'acc_a',
  methodId,
  currency: 'USD',
  amount: '80.00',
  usdRate: '1',
  reference,
});

const rejection = (result: PromiseSettledResult<unknown>) =>
  (result as PromiseRejectedResult).reason;
/** Each result either succeeded or lost with a `CONFLICT`; anything else is a 500 the client cannot retry. */
function expectNoServerError(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === 'rejected') expect(rejection(result)).toMatchObject({ code: 'CONFLICT' });
  }
}

const entry = (entityType: 'INVOICE' | 'PAYMENT', entityId: string) =>
  admin.searchEntry.findUniqueOrThrow({
    where: { entityType_entityId: { entityType, entityId } },
  });

/** The unit of work `UpdateClient` becomes in step B: the client row locked first, renamed, dependants rewritten. */
function renameClient(world: PaymentWorld, label: string, gate?: Gate) {
  const search = new PrismaSearchIndex(world.host);
  const dependents = new FinanceClientSearchDependents(world.host, search);
  const adapter = gate ? gated(dependents, gate, ['relabelClient'], 'before') : dependents;
  const locks = new PrismaRowLocks(world.host);
  return () =>
    world.uow.run(
      async () => {
        if (!RED) await locks.lock({ Client: ['cli_a'] });
        await world.host.db.client.update({ where: { id: 'cli_a' }, data: { tradeName: label } });
        await adapter.relabelClient('cli_a', label);
      },
      { isolation: RED ? 'ReadCommitted' : 'Serializable' },
    );
}

/** The unit of work `UpdatePaymentMethod` becomes in step B: no lock class exists for catalogs. */
function renameMethod(world: PaymentWorld, name: string, gate?: Gate) {
  const dependents = new FinancePaymentMethodSearchDependents(
    world.host,
    new PrismaSearchIndex(world.host),
  );
  const adapter = gate ? gated(dependents, gate, ['relabelMethod'], 'before') : dependents;
  return () =>
    world.uow.run(
      async () => {
        await world.host.db.paymentMethod.update({ where: { id: methodId }, data: { name } });
        await adapter.relabelMethod(methodId, name);
      },
      { isolation: RED ? 'ReadCommitted' : 'Serializable' },
    );
}

/** A world whose writes pause once, at the first fact it is about to write (it then holds its locks). */
function pausedWorld() {
  const gate = new Gate();
  const world = buildPaymentWorld(service, {
    writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before'),
  });
  return { gate, world };
}

describe('create invoice versus a client relabel', () => {
  it('ends with the new label when the invoice transaction holds the client first', async () => {
    const { gate, world: slow } = pausedWorld();
    const fast = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, invoiceInput('N-1') as never),
      renameClient(fast, 'Nuevo Nombre'),
    );

    expectNoServerError(results);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const invoice = await admin.invoice.findFirstOrThrow({});
    expect((await entry('INVOICE', invoice.id)).subtitle).toBe('Nuevo Nombre');
  });

  it('ends with the new label when the rename holds the client first', async () => {
    const gate = new Gate();
    const slow = buildPaymentWorld(service);
    const fast = buildPaymentWorld(service);

    const results = await interleave(admin, gate, renameClient(slow, 'Nuevo Nombre', gate), () =>
      fast.create.execute(owner, invoiceInput('N-1') as never),
    );

    expectNoServerError(results);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const invoice = await admin.invoice.findFirstOrThrow({});
    expect((await entry('INVOICE', invoice.id)).subtitle).toBe('Nuevo Nombre');
  });
});

describe('void an invoice versus a client relabel', () => {
  it('ends with the new label on the voided invoice', async () => {
    const setup = buildPaymentWorld(service);
    const invoice = await setup.create.execute(owner, invoiceInput('N-1') as never);
    const { gate, world: slow } = pausedWorld();
    const fast = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slow.voidInvoice.execute(owner, { id: invoice.id, reason: 'Duplicada' }),
      renameClient(fast, 'Nuevo Nombre'),
    );

    expectNoServerError(results);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const stored = await entry('INVOICE', invoice.id);
    expect(stored.subtitle).toBe('Nuevo Nombre');
    expect(stored.status).toBe('ANULADA');
  });
});

describe('create payment versus a client relabel', () => {
  it('ends with the new label on the payment entry', async () => {
    const { gate, world: slow } = pausedWorld();
    const fast = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slow.createPayment.execute(owner, paymentInput('REF-1') as never),
      renameClient(fast, 'Nuevo Nombre'),
    );

    expectNoServerError(results);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const payment = await admin.payment.findFirstOrThrow({});
    expect((await entry('PAYMENT', payment.id)).subtitle).toBe('Nuevo Nombre');
  });
});

describe('create payment versus a payment method relabel', () => {
  it('ends with the new method name when the payment transaction is first', async () => {
    const { gate, world: slow } = pausedWorld();
    const fast = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slow.createPayment.execute(owner, paymentInput('REF-1') as never),
      renameMethod(fast, 'Zelle Renombrado'),
    );

    expectNoServerError(results);
    const payment = await admin.payment.findFirst({});
    expect(payment).not.toBeNull();
    expect((await entry('PAYMENT', (payment as { id: string }).id)).body).toBe(
      'REF-1 Zelle Renombrado',
    );
  });

  it('ends with the new method name when the relabel is first', async () => {
    const gate = new Gate();
    const slow = buildPaymentWorld(service);
    const fast = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      renameMethod(slow, 'Zelle Renombrado', gate),
      () => fast.createPayment.execute(owner, paymentInput('REF-1') as never),
    );

    expectNoServerError(results);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const payment = await admin.payment.findFirstOrThrow({});
    expect((await entry('PAYMENT', payment.id)).body).toBe('REF-1 Zelle Renombrado');
  });
});
