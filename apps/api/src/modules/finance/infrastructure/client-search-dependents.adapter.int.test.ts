import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorld,
  catalogIds,
  seedAccount,
  seedClient,
  seedInvoice,
  seedPayment,
  seedProject,
  seedSearchEntry,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { FinanceClientSearchDependents } from './client-search-dependents.adapter';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const world = buildWorld(service);
const adapter = new FinanceClientSearchDependents(world.host, new PrismaSearchIndex(world.host));

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const line = (id: string) => [
  { id: `${id}_l`, projectId: 'pry_a', unitPrice: '10.00', ivaRate: null },
];
const subtitleOf = async (entityType: 'INVOICE' | 'PAYMENT', entityId: string) =>
  (
    await admin.searchEntry.findUniqueOrThrow({
      where: { entityType_entityId: { entityType, entityId } },
    })
  ).subtitle;

describe('FinanceClientSearchDependents (int)', () => {
  it('sets the new label on every invoice and payment entry of the client, whatever their state', async () => {
    await world.uow.run(async () => {
      const db = world.host.db;
      await seedClient(db, 'cli_a');
      await seedClient(db, 'cli_b');
      await seedProject(db, 'pry_a', ['cli_a']);
      await seedAccount(db, 'acc_a');
      const { methodId } = await catalogIds(db);
      const states = {
        inv_live: { status: 'EMITIDA' },
        inv_draft: { status: 'BORRADOR' },
        inv_void: { status: 'ANULADA' },
        inv_archived: { status: 'EMITIDA', archived: true },
      } as const;
      for (const [id, state] of Object.entries(states)) {
        await seedInvoice(db, { id, clientId: 'cli_a', ...state, lines: line(id) });
        await seedSearchEntry(db, {
          entityType: 'INVOICE',
          entityId: id,
          title: id,
          subtitle: 'Viejo',
        });
      }
      await seedInvoice(db, { id: 'inv_other', clientId: 'cli_b', lines: line('inv_other') });
      await seedSearchEntry(db, {
        entityType: 'INVOICE',
        entityId: 'inv_other',
        title: 'inv_other',
        subtitle: 'Otro',
      });
      for (const [id, archived] of [
        ['pay_live', false],
        ['pay_archived', true],
      ] as const) {
        await seedPayment(db, {
          id,
          clientId: 'cli_a',
          accountId: 'acc_a',
          methodId,
          amount: '10.00',
          archived,
        });
        await seedSearchEntry(db, {
          entityType: 'PAYMENT',
          entityId: id,
          title: id,
          subtitle: 'Viejo',
        });
      }
    });

    const changed = await world.uow.run(() => adapter.relabelClient('cli_a', 'Nuevo Nombre'));

    expect(changed).toBe(6);
    for (const id of ['inv_live', 'inv_draft', 'inv_void', 'inv_archived']) {
      expect(await subtitleOf('INVOICE', id)).toBe('Nuevo Nombre');
    }
    for (const id of ['pay_live', 'pay_archived']) {
      expect(await subtitleOf('PAYMENT', id)).toBe('Nuevo Nombre');
    }
    expect(await subtitleOf('INVOICE', 'inv_other')).toBe('Otro');
  });

  it('changes nothing when the label is already current and when the client has no documents', async () => {
    await world.uow.run(async () => {
      await seedClient(world.host.db, 'cli_a');
      await seedClient(world.host.db, 'cli_empty');
      await seedProject(world.host.db, 'pry_a', ['cli_a']);
      await seedInvoice(world.host.db, { id: 'inv_a', clientId: 'cli_a', lines: line('inv_a') });
      await seedSearchEntry(world.host.db, {
        entityType: 'INVOICE',
        entityId: 'inv_a',
        title: 'inv_a',
        subtitle: 'Igual',
      });
    });

    expect(await world.uow.run(() => adapter.relabelClient('cli_a', 'Igual'))).toBe(0);
    expect(await world.uow.run(() => adapter.relabelClient('cli_empty', 'Algo'))).toBe(0);
  });
});
