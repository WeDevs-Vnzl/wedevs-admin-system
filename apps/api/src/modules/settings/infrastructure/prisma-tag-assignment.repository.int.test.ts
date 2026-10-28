import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeClient, makeProject } from '../../../../test/db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaTagAssignmentRepository } from './prisma-tag-assignment.repository';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const assignments = new PrismaTagAssignmentRepository(host);
const uow = new PrismaUnitOfWork(host);

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.tag.createMany({
    data: [
      { id: 't1', name: 'Alpha', color: '#000001', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 't2', name: 'Beta', color: '#000002', createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 't3', name: 'Gamma', color: '#000003', createdAt: new Date('2026-01-03T00:00:00Z') },
    ],
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaTagAssignmentRepository (int)', () => {
  it('adds the missing pairs once, reads them back and removes them', async () => {
    const client = await makeClient(admin);
    const target = { entityType: 'CLIENT', entityId: client.id } as const;
    await uow.run(() => assignments.add(target, ['t2', 't1']));
    await uow.run(() => assignments.add(target, ['t1', 't3']));
    expect((await assignments.tagIdsFor(target)).sort()).toEqual(['t1', 't2', 't3']);
    expect(await admin.tagAssignment.count({ where: { clientId: client.id } })).toBe(3);

    await uow.run(() => assignments.remove(target, ['t1', 't3']));
    expect(await assignments.tagIdsFor(target)).toEqual(['t2']);
  });

  it('refuses to write outside a unit of work, even an empty write', async () => {
    const target = { entityType: 'CLIENT', entityId: 'any' } as const;
    await expect(assignments.add(target, [])).rejects.toThrow(/unit of work/);
    await expect(assignments.remove(target, ['t1'])).rejects.toThrow(/unit of work/);
  });

  it('rolls the rows back with the unit of work', async () => {
    const client = await makeClient(admin);
    const target = { entityType: 'CLIENT', entityId: client.id } as const;
    await expect(
      uow.run(async () => {
        await assignments.add(target, ['t1']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await assignments.tagIdsFor(target)).toEqual([]);
  });

  it('keeps targets of different types apart (tag_one_target: one column per row)', async () => {
    const client = await makeClient(admin);
    const project = await makeProject(admin);
    await uow.run(async () => {
      await assignments.add({ entityType: 'CLIENT', entityId: client.id }, ['t1']);
      await assignments.add({ entityType: 'PROJECT', entityId: project.id }, ['t1', 't2']);
    });
    const rows = await admin.tagAssignment.findMany({ where: { tagId: 't1' } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const set = [row.clientId, row.projectId].filter((v) => v !== null);
      expect(set).toHaveLength(1);
    }
    expect(await assignments.tagIdsFor({ entityType: 'PROJECT', entityId: client.id })).toEqual([]);
  });

  it('refuses a row with no target or two targets at the database (tag_one_target)', async () => {
    const client = await makeClient(admin);
    const project = await makeProject(admin);
    await expect(admin.tagAssignment.create({ data: { tagId: 't1' } })).rejects.toThrow(
      /tag_one_target/,
    );
    await expect(
      admin.tagAssignment.create({
        data: { tagId: 't1', clientId: client.id, projectId: project.id },
      }),
    ).rejects.toThrow(/tag_one_target/);
  });

  it('tagsFor returns chips per target in creation order, empty for an untagged target', async () => {
    const c1 = await makeClient(admin);
    const c2 = await makeClient(admin);
    const project = await makeProject(admin);
    await uow.run(async () => {
      await assignments.add({ entityType: 'CLIENT', entityId: c1.id }, ['t3', 't1']);
      await assignments.add({ entityType: 'PROJECT', entityId: project.id }, ['t2']);
    });
    const result = await assignments.tagsFor([
      { entityType: 'CLIENT', entityId: c1.id },
      { entityType: 'CLIENT', entityId: c2.id },
      { entityType: 'PROJECT', entityId: project.id },
    ]);
    expect(result.get(`CLIENT:${c1.id}`)?.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(result.get(`CLIENT:${c2.id}`)).toEqual([]);
    expect(result.get(`PROJECT:${project.id}`)?.map((t) => t.id)).toEqual(['t2']);
  });

  it('cascades the assignments when the tag is deleted', async () => {
    const client = await makeClient(admin);
    await uow.run(() => assignments.add({ entityType: 'CLIENT', entityId: client.id }, ['t1']));
    await admin.tag.delete({ where: { id: 't1' } });
    expect(await admin.tagAssignment.count()).toBe(0);
  });
});
