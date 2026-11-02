import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClientSearchDependentsPort } from '../../../src/modules/commercial/application/ports/client-search-dependents.port';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { buildPaymentWorld } from '../../finance/payments/int-world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildWorld, Gate, gated, interleave, ownerOf, seedClient, seedProject } from './world';

/**
 * The real `UpdateClient` (client row locked first, `Serializable`) against the project flows and the invoice
 * flow, over real PostgreSQL and the real finance dependants adapter (DT-166, DT-177). The first transaction is
 * paused (`Gate`); the second one then runs. Either order must leave the new name in every entry, and the
 * loser retries or answers `CONFLICT`, never a 500. The last test exhausts the retries: nothing is written.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const entry = (entityType: 'PROJECT' | 'INVOICE' | 'CLIENT', entityId: string) =>
  admin.searchEntry.findUniqueOrThrow({
    where: { entityType_entityId: { entityType, entityId } },
  });

/** The full form of a seeded client with another trade name (the body of `PATCH /clients/{id}`). */
async function renameInput(id: string, tradeName: string) {
  const row = await admin.client.findUniqueOrThrow({ where: { id } });
  return {
    id,
    kind: row.kind,
    tradeName,
    legalName: row.legalName,
    taxId: row.taxId,
    country: row.country,
    address: row.address,
    phone: row.phone,
    tagIds: [],
  };
}

const projectForm = (id: string, clientIds: readonly string[], name = `Proyecto ${id}`) => ({
  id,
  name,
  summary: 'Resumen',
  clients: clientIds.map((clientId) => ({ clientId })),
  technologyIds: [],
  tagIds: [],
});

const rejection = (result: PromiseSettledResult<unknown>) =>
  (result as PromiseRejectedResult).reason;
/** Each result either succeeded or lost with a `CONFLICT`; anything else is a 500 the client cannot retry. */
function expectNoServerError(results: readonly PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === 'rejected') expect(rejection(result)).toMatchObject({ code: 'CONFLICT' });
  }
}
const bothFulfilled = (results: readonly PromiseSettledResult<unknown>[]) =>
  results.map((result) => result.status);

describe('a project mutation versus a client rename', () => {
  // An edit that changes nothing writes no activity entry, so it does not touch `ClientMetrics` either and
  // nothing but the isolation level stops it from writing back the name it read before the rename.
  it('an edit that read the old name does not overwrite the renamed entry (DT-177)', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const gate = new Gate();
    const slow = buildWorld(service, {
      projects: (repo) => gated(repo, gate, ['clientLegalNames'], 'after'),
    });
    const fast = buildWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slow.updateProject.execute(caller, projectForm('pry_a', ['cli_a'])),
      async () => fast.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    const stored = await entry('PROJECT', 'pry_a');
    expect(stored.title).toBe('Proyecto pry_a');
    expect(stored.subtitle).toBe('Nombre Nuevo');
  });

  it('a link change that read the old name keeps both client names current', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedClient(admin, 'cli_b');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const gate = new Gate();
    const slow = buildWorld(service, {
      projects: (repo) => gated(repo, gate, ['clientLegalNames'], 'after'),
    });
    const fast = buildWorld(service);

    const results = await interleave(
      admin,
      gate,
      () =>
        slow.setProjectClients.execute(caller, {
          id: 'pry_a',
          clients: [{ clientId: 'cli_a' }, { clientId: 'cli_b' }],
        }),
      async () => fast.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    expect((await entry('PROJECT', 'pry_a')).subtitle).toBe('Nombre Nuevo, Cliente cli_b');
  });

  it('a rename that is first makes the status change write the new name', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const gate = new Gate();
    const slow = buildWorld(service, {
      dependents: (dependents) => gated(dependents, gate, ['relabelClient'], 'before'),
    });
    const fast = buildWorld(service);

    const results = await interleave(
      admin,
      gate,
      async () => slow.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
      () =>
        fast.setProjectStatus.execute(caller, {
          id: 'pry_a',
          status: 'EN_CURSO',
          startDate: '2026-10-01',
          cancelPendingInstallments: false,
          finishRecurringCharges: false,
          confirm: false,
        }),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    const stored = await entry('PROJECT', 'pry_a');
    expect(stored.subtitle).toBe('Nombre Nuevo');
    expect(stored.status).toBe('EN_CURSO');
  });
});

describe('an invoice create versus a client rename, through the real finance adapter', () => {
  const invoiceInput = {
    clientId: 'cli_a',
    invoiceNumber: 'N-1',
    issueDate: '2026-10-01',
    dueDate: '2026-11-01',
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Servicio', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
  };

  it('the invoice entry ends with the new name when the invoice holds the client first', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const gate = new Gate();
    const slowInvoices = buildPaymentWorld(service, {
      writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before'),
    });
    const fast = buildWorld(service);

    const results = await interleave(
      admin,
      gate,
      () => slowInvoices.create.execute(caller, invoiceInput as never),
      async () => fast.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    const invoice = await admin.invoice.findFirstOrThrow({});
    expect((await entry('INVOICE', invoice.id)).subtitle).toBe('Nombre Nuevo');
    expect((await entry('PROJECT', 'pry_a')).subtitle).toBe('Nombre Nuevo');
  });

  it('the invoice entry ends with the new name when the rename holds the client first', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const gate = new Gate();
    const slow = buildWorld(service, {
      dependents: (dependents) => gated(dependents, gate, ['relabelClient'], 'before'),
    });
    const fastInvoices = buildPaymentWorld(service);

    const results = await interleave(
      admin,
      gate,
      async () => slow.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
      () => fastInvoices.create.execute(caller, invoiceInput as never),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    const invoice = await admin.invoice.findFirstOrThrow({});
    expect((await entry('INVOICE', invoice.id)).subtitle).toBe('Nombre Nuevo');
  });
});

describe('two renames of clients that share a project', () => {
  it('end with both names in the project entry, retried, no 500', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedClient(admin, 'cli_b');
    await seedProject(admin, 'pry_shared', ['cli_a', 'cli_b']);
    const gate = new Gate();
    const slow = buildWorld(service, {
      dependents: (dependents) => gated(dependents, gate, ['relabelClient'], 'before'),
    });
    const fast = buildWorld(service);

    const results = await interleave(
      admin,
      gate,
      async () => slow.updateClient.execute(caller, await renameInput('cli_a', 'Alfa Nuevo')),
      async () => fast.updateClient.execute(caller, await renameInput('cli_b', 'Beta Nuevo')),
    );

    expectNoServerError(results);
    expect(bothFulfilled(results)).toEqual(['fulfilled', 'fulfilled']);
    expect((await entry('PROJECT', 'pry_shared')).subtitle).toBe('Alfa Nuevo, Beta Nuevo');
  });
});

describe('a rename whose retries are exhausted', () => {
  it('answers CONFLICT and writes nothing at all', async () => {
    const caller = await ownerOf(admin);
    await seedClient(admin, 'cli_a');
    await seedProject(admin, 'pry_a', ['cli_a']);
    const invoices = buildPaymentWorld(service);
    const invoice = await invoices.create.execute(caller, {
      clientId: 'cli_a',
      invoiceNumber: 'N-9',
      issueDate: '2026-10-01',
      dueDate: '2026-11-01',
      currency: 'USD',
      usdRate: '1',
      lines: [{ description: 'Servicio', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
    } as never);
    const before = await admin.searchEntry.findMany({ orderBy: { entityId: 'asc' } });
    const activityBefore = await admin.activityLog.count();

    // Each attempt reads first and then finds the invoice entry changed by a transaction that committed after
    // its snapshot, so the write of the dependants fails with a serialization failure every time.
    let attempts = 0;
    const world = buildWorld(service, {
      dependents: (dependents): ClientSearchDependentsPort => ({
        relabelClient: async (clientId, label) => {
          attempts += 1;
          await admin.$executeRaw`UPDATE "SearchEntry" SET "updatedAt" = now()
            WHERE "entityType" = 'INVOICE' AND "entityId" = ${invoice.id}`;
          return dependents.relabelClient(clientId, label);
        },
      }),
    });

    await expect(
      world.updateClient.execute(caller, await renameInput('cli_a', 'Nombre Nuevo')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(attempts).toBe(3);
    expect((await admin.client.findUniqueOrThrow({ where: { id: 'cli_a' } })).tradeName).toBe(
      'Cliente cli_a',
    );
    expect(await admin.activityLog.count()).toBe(activityBefore);
    const after = await admin.searchEntry.findMany({ orderBy: { entityId: 'asc' } });
    expect(after.map((row) => [row.entityId, row.subtitle, row.title])).toEqual(
      before.map((row) => [row.entityId, row.subtitle, row.title]),
    );
  });
});
