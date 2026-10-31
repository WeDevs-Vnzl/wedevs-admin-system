import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { buildWorld, Gate, gated, interleave, ownerOf, seedClient } from './world';

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

describe('Client archive locks the client rows (M1)', () => {
  it('a double archive archives once and restore brings the contacts back', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await admin.contact.create({
        data: { id: 'con_1', clientId: 'cli_a', fullName: 'Ana', email: 'ana@example.test' },
      });
      const gate = new Gate();
      const slow = buildWorld(service, { clients: (r) => gated(r, gate, ['archive']) });
      const fast = buildWorld(service);

      const [first, second] = await interleave(
        admin,
        gate,
        () => slow.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
        () => fast.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
      );

      expect([first, second].filter(fulfilled)).toHaveLength(1);
      expect(reason(first) ?? reason(second)).toMatchObject({ code: 'NOT_FOUND' });
      const client = await admin.client.findUniqueOrThrow({ where: { id: 'cli_a' } });
      const contact = await admin.contact.findUniqueOrThrow({ where: { id: 'con_1' } });
      expect(contact.deletedAt?.getTime()).toBe(client.deletedAt?.getTime());
      expect(
        await admin.activityLog.count({
          where: { entityType: 'CLIENT', entityId: 'cli_a', action: 'DELETE' },
        }),
      ).toBe(1);

      await fast.restoreClient.execute(caller, { id: 'cli_a' });
      expect(
        (await admin.contact.findUniqueOrThrow({ where: { id: 'con_1' } })).deletedAt,
      ).toBeNull();
    }
  });

  it('a contact cannot be created on a client that is being archived', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      const gate = new Gate();
      const archiving = buildWorld(service, {
        contacts: (r) => gated(r, gate, ['archiveLiveOfClient'], 'after'),
      });
      const creating = buildWorld(service);

      const [archive, create] = await interleave(
        admin,
        gate,
        () => archiving.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
        () =>
          creating.createContact.execute(caller, {
            clientId: 'cli_a',
            fullName: 'Ana',
            email: 'ana@example.test',
          }),
      );

      expect(archive.status).toBe('fulfilled');
      expect(reason(create)).toMatchObject({ code: 'NOT_FOUND' });
      expect(await admin.contact.count({ where: { clientId: 'cli_a', deletedAt: null } })).toBe(0);
    }
  });

  it('a contact cannot be restored under a client that is being archived', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      const caller = await ownerOf(admin);
      await seedClient(admin, 'cli_a');
      await admin.contact.create({
        data: {
          id: 'con_old',
          clientId: 'cli_a',
          fullName: 'Vieja',
          email: 'vieja@example.test',
          deletedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      const gate = new Gate();
      const archiving = buildWorld(service, {
        contacts: (r) => gated(r, gate, ['archiveLiveOfClient'], 'after'),
      });
      const restoring = buildWorld(service);

      const [archive, restore] = await interleave(
        admin,
        gate,
        () => archiving.archiveClients.execute(caller, { ids: ['cli_a'], confirm: true }),
        () => restoring.restoreContact.execute(caller, { id: 'con_old' }),
      );

      expect(archive.status).toBe('fulfilled');
      expect(reason(restore)).toMatchObject({ code: 'CONFLICT' });
      expect(await admin.contact.count({ where: { clientId: 'cli_a', deletedAt: null } })).toBe(0);
    }
  });
});
