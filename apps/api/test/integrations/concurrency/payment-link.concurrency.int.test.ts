import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { CreateInvoicePaymentLink } from '../../../src/modules/integrations/application/use-cases/payment-links/create-invoice-payment-link.use-case';
import { FinanceInvoiceForLink } from '../../../src/modules/integrations/infrastructure/finance-invoice-for-link.adapter';
import { PrismaPaymentLinkRepository } from '../../../src/modules/integrations/infrastructure/prisma-payment-link.repository';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { buildInvoiceWorld } from '../../finance/invoices/int-world';
import { Gate, gated, interleave, seedClient, seedInvoice } from '../../finance/concurrency/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { ScriptedProvider } from '../payment-links/world';

/**
 * Concurrent link creations over real PostgreSQL (choice 5, DT-196, A13). The first transaction is paused
 * once its link row is written, holding the `Invoice` lock; the second one then runs. With the lock and
 * `Serializable` the second queues, sees the committed row and is refused (or answered with the same link
 * for one `requestId`); without them it works on a stale read and both commit.
 * `PAYMENT_LINK_CONCURRENCY_RED=1` removes the lock and forces `ReadCommitted`: these tests must then fail.
 */
const RED = process.env.PAYMENT_LINK_CONCURRENCY_RED === '1';
const noLocks = (): RowLocksPort => ({ lock: async () => undefined });
const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

const REQ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let owner: CurrentUser;

/** The link use cases over the real adapters and one provider shared by every world of a test. */
function buildWorld(provider: ScriptedProvider, hooks: { gate?: Gate } = {}) {
  const base = buildInvoiceWorld(service);
  const { host } = base;
  const uow = RED ? readCommitted(base.uow) : base.uow;
  const locks = RED ? noLocks() : new PrismaRowLocks(host);
  const plain = new PrismaPaymentLinkRepository(host);
  const links = hooks.gate ? gated(plain, hooks.gate, ['save'], 'after') : plain;
  const invoices = new FinanceInvoiceForLink(base.support);
  const authorization = new MatrixAuthorization();
  const activity = new PrismaActivityLog(host, new PrismaClientMetricsWriter(host));
  const clock = new SystemClock();
  return {
    base,
    links: plain,
    create: new CreateInvoicePaymentLink(
      authorization,
      uow,
      invoices,
      links,
      provider,
      locks,
      activity,
      new CuidGenerator(),
      clock,
    ),
  };
}

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_link_conc', email: 'link@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  const setup = buildInvoiceWorld(service);
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedInvoice(setup.host.db, {
      id: 'inv_a',
      clientId: 'cli_a',
      lines: [{ id: 'inv_a_l', projectId: null, unitPrice: '100.00', ivaRate: null }],
    });
  });
}, 60_000);

const refusal = (result: PromiseSettledResult<unknown>) => (result as PromiseRejectedResult).reason;
const request = (amount: string, requestId: string) => ({
  invoiceId: 'inv_a',
  amount,
  requestId,
});

describe('two link creations racing past the balance', () => {
  it('60 and 60 on a balance of 100: one link, one provider creation, the other refused', async () => {
    const provider = new ScriptedProvider();
    const gate = new Gate();
    const slow = buildWorld(provider, { gate });
    const fast = buildWorld(provider);

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, request('60', REQ_A)),
      () => fast.create.execute(owner, request('60', REQ_B)),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { amount: ['validation.paymentLinkExceedsCapacity'] },
    });
    const rows = await admin.invoicePaymentLink.findMany();
    expect(rows.map((row) => [row.amount.toFixed(2), row.status])).toEqual([['60.00', 'ACTIVE']]);
    expect(provider.createKeys).toHaveLength(1);
    expect(provider.links.size).toBe(1);
    expect(await admin.activityLog.count({ where: { entityType: 'PAYMENT_LINK' } })).toBe(1);
  });

  it('two calls with one requestId: one link, one provider link, both answered with it', async () => {
    const provider = new ScriptedProvider();
    const gate = new Gate();
    const slow = buildWorld(provider, { gate });
    const fast = buildWorld(provider);

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, request('40', REQ_A)),
      () => fast.create.execute(owner, request('40', REQ_A)),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const [one, two] = results.map(
      (result) => (result as PromiseFulfilledResult<{ id: string }>).value,
    );
    expect(two?.id).toBe(one?.id);
    expect(await admin.invoicePaymentLink.count()).toBe(1);
    expect(provider.links.size).toBe(1);
    expect(new Set(provider.createKeys).size).toBe(1);
    expect(await admin.activityLog.count({ where: { entityType: 'PAYMENT_LINK' } })).toBe(1);
  });

  it('four free-running creations of 30 on 100: successes plus refusals = 4, never above the balance', async () => {
    const provider = new ScriptedProvider();
    const worlds = [0, 1, 2, 3].map(() => buildWorld(provider));
    const ids = [
      REQ_A,
      REQ_B,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    ];
    const results = await Promise.allSettled(
      worlds.map((world, index) =>
        world.create.execute(owner, request('30', ids[index] as string)),
      ),
    );

    const ok = results.filter((result) => result.status === 'fulfilled').length;
    const refused = results.filter(
      (result) =>
        result.status === 'rejected' &&
        ['VALIDATION', 'CONFLICT'].includes((result.reason as { code?: string }).code ?? ''),
    ).length;
    expect(ok + refused).toBe(4);
    const rows = await admin.invoicePaymentLink.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE'] } },
    });
    expect(rows).toHaveLength(ok);
    expect(ok).toBeLessThanOrEqual(3);
    expect(rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBeLessThanOrEqual(100);
    expect(provider.links.size).toBe(ok);
  });
});
