import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FinanceLookups } from '../../../src/modules/commercial/application/finance-lookups';
import { ArchiveClients } from '../../../src/modules/commercial/application/use-cases/archive-clients.use-case';
import { PrismaClientRepository } from '../../../src/modules/commercial/infrastructure/prisma-client.repository';
import { PrismaContactRepository } from '../../../src/modules/commercial/infrastructure/prisma-contact.repository';
import { PrismaFinanceLookups } from '../../../src/modules/commercial/infrastructure/prisma-finance-lookups';
import { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import { ProjectBillingApi } from '../../../src/modules/finance/application/use-cases/billing/project-billing.api';
import { FinanceClientDependents } from '../../../src/modules/finance/infrastructure/client-finance-dependents.adapter';
import { FinanceProjectBilling } from '../../../src/modules/finance/infrastructure/finance-project-billing.adapter';
import { CommercialBillingProjectsAdapter } from '../../../src/modules/finance/infrastructure/billing-projects.adapter';
import { PrismaBillingRepository } from '../../../src/modules/finance/infrastructure/prisma-billing.repository';
import { PrismaFinanceSources } from '../../../src/modules/finance/infrastructure/prisma-finance-sources';
import { PrismaReadModelWriter } from '../../../src/modules/finance/infrastructure/prisma-read-model-writer';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { buildWorld as buildCommercial } from '../../commercial/concurrency/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildInvoiceWorld } from '../invoices/int-world';
import { seedClient, seedProject } from '../../commercial/concurrency/world';
import { Gate, gated, interleave } from './world';

/**
 * Package 6.3: the neutral finance ports of `commercial` are bound to finance, and the races they exist to
 * close are real (C18, C19; lessons B3, M1, M2). Each test pauses the first transaction after it wrote and
 * runs the second one. With the ordered locks and `Serializable` the second waits for the first and reads
 * its committed result; without them (`COMMERCIAL_REBIND_RED=1`: no row locks, `ReadCommitted`) it works on
 * a stale read and the commits disagree (an invoice on a cancelled installment, an archived client with an
 * open invoice).
 */
const RED = process.env.COMMERCIAL_REBIND_RED === '1';
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
let owner: CurrentUser;

const noLocks = (): RowLocksPort => ({ lock: async () => undefined });
const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});

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
      clerkId: 'user_rebind_conc',
      email: 'rebind@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  await seedClient(admin, 'cli_a');
  await seedProject(admin, 'pry_a', ['cli_a']);
  await admin.project.update({
    where: { id: 'pry_a' },
    data: { status: 'EN_CURSO', startDate: new Date('2026-01-01') },
  });
  await admin.billingInstallment.create({
    data: {
      id: 'ins_a',
      projectId: 'pry_a',
      kind: 'CUOTA',
      label: 'Cuota',
      amount: '100.00',
      currency: 'USD',
    },
  });
}, 60_000);

const refusal = (result: PromiseSettledResult<unknown>) => (result as PromiseRejectedResult).reason;

const invoiceInput = (invoiceNumber: string) => ({
  clientId: 'cli_a',
  invoiceNumber,
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  lines: [
    {
      description: 'Cuota',
      projectId: 'pry_a',
      installmentId: 'ins_a',
      unitPrice: '70.00',
      ivaRate: null,
    },
  ],
});

/** The invoice use cases; the first one of a pair is paused once its source row is written. */
function invoices(gate?: Gate) {
  return buildInvoiceWorld(service, {
    ...(gate ? { writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before') } : {}),
    ...(RED ? { locks: noLocks, uow: readCommitted } : {}),
  });
}

/** `SetProjectStatus` over the real finance adapter; with a gate it pauses before the metrics are projected. */
function commercial(gate?: Gate) {
  return buildCommercial(service, {
    ...(RED ? { uow: readCommitted } : {}),
    billing: ({ host, uow }) => {
      const writer = new PrismaReadModelWriter(host);
      const projector = new FinanceProjector(
        new PrismaFinanceSources(host),
        gate
          ? gated(writer, gate, ['writeProjectMetrics', 'writeClientMetrics'], 'before')
          : writer,
        new SystemClock(),
      );
      const lookups = new FinanceLookups(new PrismaFinanceLookups(host));
      return new FinanceProjectBilling(
        new ProjectBillingApi(
          uow,
          new PrismaBillingRepository(host),
          new CommercialBillingProjectsAdapter(lookups),
          projector,
          new SystemClock(),
        ),
        lookups,
        RED ? noLocks() : new PrismaRowLocks(host),
      );
    },
  });
}

const cancel = (world: ReturnType<typeof commercial>) =>
  world.setProjectStatus.execute(owner, {
    id: 'pry_a',
    status: 'CANCELADO',
    cancelPendingInstallments: true,
    finishRecurringCharges: true,
    confirm: true,
  });

describe('cancel project vs bill installment (HU-08 CA3, Q-BE3-1)', () => {
  it('a cancel in flight blocks the invoice, which then sees the installment cancelled', async () => {
    const gate = new Gate();
    const slow = commercial(gate);
    const fast = invoices();

    const results = await interleave(
      admin,
      gate,
      () => cancel(slow),
      () => fast.create.execute(owner, invoiceInput('RB-1') as never),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(['VALIDATION', 'CONFLICT']).toContain(refusal(results[1]).code);
    expect(await admin.invoice.count()).toBe(0);
    expect(await admin.invoiceLine.count({ where: { installmentId: 'ins_a' } })).toBe(0);
    const row = await admin.billingInstallment.findUniqueOrThrow({ where: { id: 'ins_a' } });
    expect(row.status).toBe('CANCELADA');
    expect(row.cancelledAt).not.toBeNull();
  });

  it('an invoice in flight blocks the cancel, which then leaves the billed installment alone', async () => {
    const gate = new Gate();
    const slow = invoices(gate);
    const fast = commercial();

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, invoiceInput('RB-2') as never),
      () => cancel(fast),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await admin.invoice.count()).toBe(1);
    const row = await admin.billingInstallment.findUniqueOrThrow({ where: { id: 'ins_a' } });
    expect(row.status).toBe('FACTURADA');
    expect(row.cancelledAt).toBeNull();
    const entry = await admin.activityLog.findFirstOrThrow({
      where: { entityType: 'PROJECT', entityId: 'pry_a', action: 'STATUS_CHANGE' },
    });
    expect(entry.metadata).toMatchObject({ cancelledInstallments: 0 });
    expect((await admin.project.findUniqueOrThrow({ where: { id: 'pry_a' } })).status).toBe(
      'CANCELADO',
    );
  });
});

describe('archive client vs create invoice (C19)', () => {
  async function deliver() {
    // A delivered project does not lock the client archive, so only an open invoice can.
    await admin.project.update({ where: { id: 'pry_a' }, data: { status: 'ENTREGADO' } });
  }

  function archiver(world: ReturnType<typeof buildInvoiceWorld>, pause?: () => Promise<void>) {
    const { host, uow } = world;
    const dependents = new FinanceClientDependents(world.invoices);
    return new ArchiveClients(
      new MatrixAuthorization(),
      uow,
      new PrismaClientRepository(host),
      new PrismaContactRepository(host),
      {
        hasOpenInvoices: async (clientId: string) => {
          const open = await dependents.hasOpenInvoices(clientId);
          if (pause) await pause();
          return open;
        },
      },
      new PrismaActivityLog(host, new PrismaClientMetricsWriter(host)),
      new PrismaSearchIndex(host),
      new SystemClock(),
    );
  }

  it('an archive that already checked the open invoices blocks the create, which finds no client', async () => {
    await deliver();
    const gate = new Gate();
    const archive = archiver(invoices(), () => gate.pause());
    const fast = invoices();

    const results = await interleave(
      admin,
      gate,
      () => archive.execute(owner, { ids: ['cli_a'], confirm: false }),
      () => fast.create.execute(owner, invoiceInput('RB-3') as never),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({ code: 'NOT_FOUND' });
    expect(await admin.invoice.count()).toBe(0);
  });

  it('a create in flight blocks the archive, whose open-invoice check then sees the invoice', async () => {
    await deliver();
    const gate = new Gate();
    const slow = invoices(gate);
    const archive = archiver(invoices());

    const results = await interleave(
      admin,
      gate,
      () => slow.create.execute(owner, invoiceInput('RB-4') as never),
      () => archive.execute(owner, { ids: ['cli_a'], confirm: false }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(refusal(results[1])).toMatchObject({ code: 'INTEGRITY_LOCK' });
    expect((await admin.client.findUniqueOrThrow({ where: { id: 'cli_a' } })).deletedAt).toBeNull();
    expect(await admin.invoice.count({ where: { status: 'EMITIDA' } })).toBe(1);
  });
});
