import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { buildWorld, Gate, gated, interleave, ownerOf, seedClient, seedProject } from './world';

/**
 * Two truly concurrent transactions over real PostgreSQL (B3, M1, M2 of the BE-2 fix round). The first
 * one is paused (`Gate`) between its read and its write; the second one then runs. Without a row lock
 * the second commits inside the first one's window (the lost update / the attach to an archiving
 * client); with the lock it blocks until the first commits and then sees its result. Each scenario
 * repeats so a timing accident cannot hide a regression.
 */
const ROUNDS = 3;
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const fulfilled = (r: PromiseSettledResult<unknown>) => r.status === 'fulfilled';
const reason = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' ? (r.reason as { code?: string }) : undefined;

const updateInput = (id: string, clientId: string, name: string) => ({
  id,
  name,
  summary: 'Resumen',
  clients: [{ clientId }],
  technologyIds: [],
  tagIds: [],
});
const createInput = (name: string, clientId: string) => ({
  name,
  summary: 'Resumen',
  status: 'PROPUESTA' as const,
  clients: [{ clientId }],
  technologyIds: [],
  tagIds: [],
  links: [],
});
describe('Project paths lock the client rows they attach to or recount (M1, M2)', () => {
  const count = async (clientId: string) =>
    (await admin.clientMetrics.findUniqueOrThrow({ where: { clientId } })).projectCount;

  it('two concurrent creates for one client give projectCount 2', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      const one = buildWorld(service);
      const two = buildWorld(service);

      const results = await Promise.allSettled([
        one.createProject.execute(caller, createInput('Uno', 'cli_a')),
        two.createProject.execute(caller, createInput('Dos', 'cli_a')),
      ]);

      expect(results.every(fulfilled)).toBe(true);
      expect(await count('cli_a')).toBe(2);
    }
  });

  it('a create racing an update that logs nothing (so it takes no ClientMetrics lock) counts both', async () => {
    // Two creates serialize on the PRY sequence row and every logged change touches the client's
    // metrics row before it recounts; an unchanged PATCH logs nothing, so it counted without a lock.
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await seedProject(admin, 'pry_1', ['cli_a']);
      await admin.clientMetrics.update({ where: { clientId: 'cli_a' }, data: { projectCount: 1 } });
      const gate = new Gate();
      const slow = buildWorld(service, { metrics: (m) => gated(m, gate, ['setProjectCount']) });
      const fast = buildWorld(service);

      const [first, second] = await interleave(
        admin,
        gate,
        () => slow.createProject.execute(caller, createInput('Nuevo', 'cli_a')),
        () => fast.updateProject.execute(caller, updateInput('pry_1', 'cli_a', 'Proyecto pry_1')),
      );

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');
      expect(await count('cli_a')).toBe(2);
    }
  });

  it('a project cannot be created for a client that is being archived', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      const gate = new Gate();
      const archiving = buildWorld(service, {
        clients: (r) => gated(r, gate, ['archive'], 'after'),
      });
      const creating = buildWorld(service);

      const [archive, create] = await interleave(
        admin,
        gate,
        () => archiving.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
        () => creating.createProject.execute(caller, createInput('Nuevo', 'cli_a')),
      );

      expect(archive.status).toBe('fulfilled');
      expect(reason(create)).toMatchObject({ code: 'VALIDATION' });
      expect(await admin.projectClient.count({ where: { clientId: 'cli_a' } })).toBe(0);
    }
  });

  it('a project cannot be moved onto a client that is being archived', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await seedClient(admin, 'cli_b');
      await seedProject(admin, 'pry_1', ['cli_b']);
      const gate = new Gate();
      const archiving = buildWorld(service, {
        clients: (r) => gated(r, gate, ['archive'], 'after'),
      });
      const moving = buildWorld(service);

      const [archive, move] = await interleave(
        admin,
        gate,
        () => archiving.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
        () =>
          moving.setProjectClients.execute(caller, {
            id: 'pry_1',
            clients: [{ clientId: 'cli_a' }, { clientId: 'cli_b' }],
          }),
      );

      expect(archive.status).toBe('fulfilled');
      expect(reason(move)).toMatchObject({ code: 'VALIDATION' });
      expect(await admin.projectClient.count({ where: { clientId: 'cli_a' } })).toBe(0);
    }
  });
});
