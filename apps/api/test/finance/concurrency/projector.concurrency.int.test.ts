import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IsolationLevel } from '../../../src/shared/application/ports/unit-of-work.port';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildWorld,
  Gate,
  gated,
  interleave,
  seedClient,
  seedInvoice,
  seedProject,
  type World,
} from './world';

/**
 * Two truly concurrent transactions over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first one is
 * paused (`Gate`) inside the projector; the second one then runs. Without the metrics row lock the
 * second commits inside the first one's window and the first one's write erases its contribution
 * (the lost update); with the lock it waits, then reads the committed state. Each scenario repeats.
 */
const ROUNDS = 3;
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const fulfilled = (result: PromiseSettledResult<unknown>) => result.status === 'fulfilled';

/** One mutation: write an invoice, then project its client the way a money use case does. */
function mutation(world: World, invoiceId: string, isolation: IsolationLevel) {
  return () =>
    world.uow.run(
      async () => {
        await seedInvoice(world.host.db, {
          id: invoiceId,
          clientId: 'cli_a',
          lines: [{ id: `${invoiceId}_l`, projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
        });
        await world.projector.projectInvoice(invoiceId);
        await world.projector.projectClients(['cli_a']);
      },
      { isolation },
    );
}

describe.each<IsolationLevel>(['ReadCommitted', 'Serializable'])(
  'two projections of the same client under %s',
  (isolation) => {
    it('never lose a contribution', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateBusinessTables(admin);
        const setup = buildWorld(service);
        await setup.uow.run(async () => {
          await seedClient(setup.host.db, 'cli_a');
          await seedProject(setup.host.db, 'pry_a', ['cli_a']);
        });
        const gate = new Gate();
        const slow = buildWorld(service, {
          sources: (s) => gated(s, gate, ['clientMetricsSource'], 'after'),
        });
        const fast = buildWorld(service);

        const results = await interleave(
          admin,
          gate,
          mutation(slow, 'inv_a', isolation),
          mutation(fast, 'inv_b', isolation),
        );

        expect(results.every(fulfilled)).toBe(true);
        const metrics = await admin.clientMetrics.findUniqueOrThrow({
          where: { clientId: 'cli_a' },
        });
        expect(metrics.invoicedUsd.toFixed(2)).toBe('200.00');
        expect(metrics.receivableUsd.toFixed(2)).toBe('200.00');
        expect(await admin.financeFact.count({ where: { kind: 'BILLED' } })).toBe(2);
      }
    });
  },
);

describe('metrics are written in the documented order', () => {
  it('overlapping clients and projects, requested in opposite orders, do not deadlock', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const setup = buildWorld(service);
      await setup.uow.run(async () => {
        for (const id of ['cli_a', 'cli_b']) await seedClient(setup.host.db, id);
        for (const id of ['pry_a', 'pry_b']) await seedProject(setup.host.db, id, ['cli_a']);
      });
      const gate = new Gate();
      const slow = buildWorld(service, {
        writer: (w) => gated(w, gate, ['lockClientMetrics'], 'after'),
      });
      const fast = buildWorld(service);
      const project = (world: World, clients: string[], projects: string[]) => () =>
        world.uow.run(async () => {
          await world.projector.projectClients(clients);
          await world.projector.projectProjects(projects);
        });

      const results = await interleave(
        admin,
        gate,
        project(slow, ['cli_a', 'cli_b'], ['pry_a', 'pry_b']),
        project(fast, ['cli_b', 'cli_a'], ['pry_b', 'pry_a']),
      );

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await admin.clientMetrics.count()).toBe(2);
      expect(await admin.projectMetrics.count()).toBe(2);
    }
  });
});
