import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArchiveClients } from '../../../src/modules/commercial/application/use-cases/archive-clients.use-case';
import { PrismaClientRepository } from '../../../src/modules/commercial/infrastructure/prisma-client.repository';
import { PrismaContactRepository } from '../../../src/modules/commercial/infrastructure/prisma-contact.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildInvoiceWorld } from '../invoices/int-world';
import { Gate, gated, interleave, seedClient, seedProject } from './world';

/**
 * Concurrent invoice mutations over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first transaction is
 * paused once it wrote its source row; the second one then runs. With the ordered locks and `Serializable` the
 * second waits and reads the committed state; without them it works on a stale read and the two commits
 * disagree (an installment billed twice, a voided invoice brought back, an invoice on a client being archived).
 * Where several writers race freely the assertion is `successes + refusals = N` plus the exact state.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_inv_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  const setup = buildInvoiceWorld(service);
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedProject(setup.host.db, 'pry_a', ['cli_a']);
    // A delivered project does not lock the archive of its client, so only the open invoices can.
    await setup.host.db.project.update({ where: { id: 'pry_a' }, data: { status: 'ENTREGADO' } });
    await setup.host.db.billingInstallment.create({
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

const input = (invoiceNumber: string, unitPrice = '70.00', over: Record<string, unknown> = {}) => ({
  clientId: 'cli_a',
  invoiceNumber,
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  lines: [
    { description: 'Cuota', projectId: 'pry_a', installmentId: 'ins_a', unitPrice, ivaRate: null },
  ],
  ...over,
});

/**
 * Two worlds, the first one paused once its source row is written (it then holds whatever the use case
 * locked); the second either waits for it (locks) or runs on a stale read (no locks).
 */
function twoWorlds() {
  const gate = new Gate();
  const slow = buildInvoiceWorld(service, {
    writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before'),
  });
  const fast = buildInvoiceWorld(service);
  return { gate, slow, fast };
}

const refusal = (result: PromiseSettledResult<unknown>) => (result as PromiseRejectedResult).reason;

describe('two invoices over-billing one installment', () => {
  it('bills 70 once: the second sees the committed line and is refused', async () => {
    const { gate, slow, fast } = twoWorlds();
    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, input('N-1') as never),
      () => fast.create.execute(owner, input('N-2') as never),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(refusal(results[1])).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'lines.0.unitPrice': ['invoices.errors.installmentExceeded'] },
    });
    const lines = await admin.invoiceLine.findMany({ where: { installmentId: 'ins_a' } });
    expect(lines.map((line) => line.netAmount.toFixed(2))).toEqual(['70.00']);
    expect(await admin.invoice.count()).toBe(1);
    const installment = await admin.billingInstallment.findUniqueOrThrow({
      where: { id: 'ins_a' },
    });
    expect(installment.status).toBe('FACTURADA');
  });

  it('four concurrent writers: successes + refusals = 4 and the installment never exceeds its amount', async () => {
    const worlds = [0, 1, 2, 3].map(() => buildInvoiceWorld(service));
    const results = await Promise.allSettled(
      worlds.map((world, index) =>
        world.create.execute(owner, input(`N-${index}`, '30.00') as never),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled.length + rejected.length).toBe(4);
    expect(fulfilled.length).toBeLessThanOrEqual(3);
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const result of rejected) {
      expect(['VALIDATION', 'CONFLICT']).toContain(refusal(result).code);
    }
    const lines = await admin.invoiceLine.findMany({ where: { installmentId: 'ins_a' } });
    expect(lines).toHaveLength(fulfilled.length);
    const billed = lines.reduce((sum, line) => sum + Number(line.netAmount), 0);
    expect(billed).toBe(30 * fulfilled.length);
    expect(billed).toBeLessThanOrEqual(100);
  });
});

describe('the same invoice number twice', () => {
  it('leaves one invoice and one CONFLICT pointing at the number', async () => {
    const { gate, slow, fast } = twoWorlds();
    const results = await interleave(
      admin,
      gate,
      () =>
        slow.create.execute(
          owner,
          input('DUP-1', '10.00', {
            lines: [{ description: 'a', unitPrice: '10.00', ivaRate: null }],
          }) as never,
        ),
      () =>
        fast.create.execute(
          owner,
          input(' dup-1 ', '10.00', {
            lines: [{ description: 'b', unitPrice: '10.00', ivaRate: null }],
          }) as never,
        ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(refusal(results[1])).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { invoiceNumber: ['invoices.errors.numberTaken'] },
    });
    expect(await admin.invoice.count()).toBe(1);
    expect(await admin.financeFact.count({ where: { kind: 'BILLED' } })).toBe(1);
  });
});

describe('update vs void', () => {
  async function seed(): Promise<string> {
    const setup = buildInvoiceWorld(service);
    const created = await setup.create.execute(owner, input('UV-1', '40.00') as never);
    return created.id;
  }

  it('an update followed by a void: the void sees the committed update and annuls it', async () => {
    const id = await seed();
    const { gate, slow, fast } = twoWorlds();
    const results = await interleave(
      admin,
      gate,
      () => slow.update.execute(owner, { ...input('UV-1', '50.00'), id } as never),
      () => fast.voidInvoice.execute(owner, { id, reason: 'Duplicada' }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await admin.invoice.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('ANULADA');
    expect(row.voidedAt).not.toBeNull();
    expect(row.total.toFixed(2)).toBe('50.00');
    expect(await admin.financeFact.count()).toBe(0);
    const installment = await admin.billingInstallment.findUniqueOrThrow({
      where: { id: 'ins_a' },
    });
    expect(installment.status).toBe('PENDIENTE');
  });

  it('a void followed by an update: the update sees the void and is refused, the invoice stays voided', async () => {
    const id = await seed();
    const { gate, slow, fast } = twoWorlds();
    const results = await interleave(
      admin,
      gate,
      () => slow.voidInvoice.execute(owner, { id, reason: 'Duplicada' }),
      () => fast.update.execute(owner, { ...input('UV-1', '50.00'), id } as never),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.voided',
    });
    const row = await admin.invoice.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('ANULADA');
    expect(row.total.toFixed(2)).toBe('40.00');
  });
});

describe('archive client vs create invoice (6.3 relies on the client lock)', () => {
  function archiver(world: ReturnType<typeof buildInvoiceWorld>, pause?: () => Promise<void>) {
    const { host, uow } = world;
    return new ArchiveClients(
      new MatrixAuthorization(),
      uow,
      new PrismaClientRepository(host),
      new PrismaContactRepository(host),
      {
        hasOpenInvoices: async (clientId: string) => {
          const open = await host.db.invoice.count({
            where: { clientId, status: { in: ['EMITIDA', 'PARCIAL', 'VENCIDA'] } },
          });
          if (pause) await pause();
          return open > 0;
        },
      },
      new PrismaActivityLog(host, world.metrics),
      new PrismaSearchIndex(host),
      new SystemClock(),
    );
  }

  it('an archive that already checked for open invoices blocks the create, which then finds no client', async () => {
    const gate = new Gate();
    const slowWorld = buildInvoiceWorld(service);
    const archive = archiver(slowWorld, () => gate.pause());
    const fast = buildInvoiceWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => archive.execute(owner, { ids: ['cli_a'], confirm: false }),
      () => fast.create.execute(owner, input('AC-1') as never),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({ code: 'NOT_FOUND' });
    expect(await admin.invoice.count()).toBe(0);
  });

  it('a create in flight blocks the archive, whose open-invoice check then sees the invoice', async () => {
    const { gate, slow, fast } = twoWorlds();
    const archive = archiver(fast);

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, input('AC-2', '10.00') as never),
      () => archive.execute(owner, { ids: ['cli_a'], confirm: false }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({ code: 'INTEGRITY_LOCK' });
    expect((await admin.client.findUniqueOrThrow({ where: { id: 'cli_a' } })).deletedAt).toBeNull();
  });
});
