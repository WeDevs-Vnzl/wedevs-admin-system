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

const status = (id: string) => admin.project.findUniqueOrThrow({ where: { id } });
const updateInput = (id: string, clientId: string, name: string) => ({
  id,
  name,
  summary: 'Resumen',
  clients: [{ clientId }],
  technologyIds: [],
  tagIds: [],
});
const statusInput = (
  id: string,
  to: 'EN_CURSO' | 'CANCELADO',
  over: { startDate?: string } = {},
) => ({
  id,
  status: to,
  ...over,
  cancelPendingInstallments: false,
  finishRecurringCharges: false,
  confirm: true,
});
const WRITES = ['updateFields', 'updateStatus'];

describe('Project mutations lock the project row (B3)', () => {
  it('a PATCH never writes a stale status over a concurrent cancellation', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await seedProject(admin, 'pry_1', ['cli_a']);
      const gate = new Gate();
      const patch = buildWorld(service, { projects: (r) => gated(r, gate, WRITES) });
      const other = buildWorld(service);

      const [first, second] = await interleave(
        admin,
        gate,
        () => patch.updateProject.execute(caller, updateInput('pry_1', 'cli_a', 'Renombrado')),
        () => other.setProjectStatus.execute(caller, statusInput('pry_1', 'CANCELADO')),
      );

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');
      const row = await status('pry_1');
      expect(row.status).toBe('CANCELADO');
      expect(row.name).toBe('Renombrado');
    }
  });

  it('two status calls cannot both pass the transition check from the same status', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await seedProject(admin, 'pry_1', ['cli_a']);
      const gate = new Gate();
      const slow = buildWorld(service, { projects: (r) => gated(r, gate, WRITES) });
      const fast = buildWorld(service);

      const [first, second] = await interleave(
        admin,
        gate,
        () =>
          slow.setProjectStatus.execute(
            caller,
            statusInput('pry_1', 'EN_CURSO', { startDate: '2026-02-01' }),
          ),
        () => fast.setProjectStatus.execute(caller, statusInput('pry_1', 'CANCELADO')),
      );

      // CANCELADO is final: whatever ran second must have seen what the first committed.
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');
      expect((await status('pry_1')).status).toBe('CANCELADO');
    }
  });

  it('two concurrent link upserts both keep their link', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await seedProject(admin, 'pry_1', ['cli_a']);
      const gate = new Gate();
      const slow = buildWorld(service, { projects: (r) => gated(r, gate, ['replaceLinks']) });
      const fast = buildWorld(service);
      const link = (label: string) => ({
        group: 'REPOSITORIO' as const,
        label,
        url: `https://example.test/${label}`,
        order: 0,
      });

      const [first, second] = await interleave(
        admin,
        gate,
        () => slow.upsertProjectLinks.execute(caller, { id: 'pry_1', links: [link('uno')] }),
        () => fast.upsertProjectLinks.execute(caller, { id: 'pry_1', links: [link('dos')] }),
      );

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');
      const labels = (await admin.projectLink.findMany({ where: { projectId: 'pry_1' } }))
        .map((l) => l.label)
        .sort();
      expect(labels).toEqual(['dos', 'uno']);
    }
  });
});
