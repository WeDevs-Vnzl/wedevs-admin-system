import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeClient, makeContact, makeProject } from '../../../../test/db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaTagRepository } from './prisma-tag.repository';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const tags = new PrismaTagRepository(host);
const uow = new PrismaUnitOfWork(host);

const query = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_LIST_QUERY, ...over });
const tag = (id: string, name: string, createdAt = '2026-01-01T00:00:00.000Z') => ({
  id,
  name,
  color: '#112233',
  createdAt: new Date(createdAt),
});

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

describe('PrismaTagRepository (int)', () => {
  it('inserts and updates inside a unit of work and refuses to write outside one', async () => {
    await expect(tags.insert(tag('t1', 'Alpha'))).rejects.toThrow(/unit of work/);
    await uow.run(() => tags.insert(tag('t1', 'Alpha')));
    await uow.run(() => tags.update({ ...tag('t1', 'Alpha'), name: 'Alfa', color: '#abcdef' }));
    expect(await tags.find('t1')).toMatchObject({ name: 'Alfa', color: '#abcdef' });
    expect(await tags.find('missing')).toBeNull();
  });

  it('finds by name ignoring case and returns only the existing ids', async () => {
    await uow.run(async () => {
      await tags.insert(tag('t1', 'Cliente clave'));
      await tags.insert(tag('t2', 'Otra'));
    });
    expect((await tags.findByName('CLIENTE CLAVE'))?.id).toBe('t1');
    expect(await tags.findByName('nada')).toBeNull();
    expect((await tags.findManyByIds(['t2', 'zzz'])).map((t) => t.id)).toEqual(['t2']);
    expect(await tags.findManyByIds([])).toEqual([]);
  });

  it('maps a lost race on the unique name to CONFLICT on name', async () => {
    await uow.run(() => tags.insert(tag('t1', 'Alpha')));
    await expect(uow.run(() => tags.insert(tag('t2', 'Alpha')))).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['tags.errors.nameTaken'] },
    });
    await uow.run(() => tags.insert(tag('t3', 'Beta')));
    await expect(uow.run(() => tags.update({ ...tag('t3', 'Alpha') }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  describe('usage (non-archived targets only)', () => {
    async function seedUsage() {
      await uow.run(async () => {
        await tags.insert(tag('t1', 'Alpha', '2026-01-01T00:00:00.000Z'));
        await tags.insert(tag('t2', 'beta', '2026-01-02T00:00:00.000Z'));
        await tags.insert(tag('t3', 'Gamma', '2026-01-03T00:00:00.000Z'));
      });
      const c1 = await makeClient(admin);
      const c2 = await makeClient(admin);
      const archived = await makeClient(admin);
      const project = await makeProject(admin);
      const contact = await makeContact(admin, c1.id);
      await admin.client.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });
      await admin.tagAssignment.createMany({
        data: [
          { tagId: 't1', clientId: c1.id },
          { tagId: 't1', clientId: c2.id },
          { tagId: 't1', clientId: archived.id },
          { tagId: 't1', projectId: project.id },
          { tagId: 't2', contactId: contact.id },
          { tagId: 't2', clientId: archived.id },
        ],
      });
      return { c1, project };
    }

    it('counts live records of every type and ignores archived ones', async () => {
      await seedUsage();
      const page = await tags.list(query({ sort: { field: 'usageCount', direction: 'desc' } }));
      expect(page.total).toBe(3);
      expect(page.items.map((r) => [r.id, r.usageCount])).toEqual([
        ['t1', 3],
        ['t2', 1],
        ['t3', 0],
      ]);
      expect((await tags.findWithUsage('t1'))?.usageCount).toBe(3);
      expect((await tags.findWithUsage('t3'))?.usageCount).toBe(0);
      expect(await tags.findWithUsage('missing')).toBeNull();
    });

    it('also leaves out a record archived after it was tagged', async () => {
      const { project } = await seedUsage();
      await admin.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
      expect((await tags.findWithUsage('t1'))?.usageCount).toBe(2);
    });

    it('filters by entity type and counts only those types', async () => {
      await seedUsage();
      const clients = await tags.list(query({ filters: { entityType: 'CLIENT' } }));
      expect(clients.items.map((r) => [r.id, r.usageCount])).toEqual([['t1', 2]]);
      const mixed = await tags.list(query({ filters: { entityType: ['PROJECT', 'CONTACT'] } }));
      expect(mixed.items.map((r) => [r.id, r.usageCount])).toEqual([
        ['t1', 1],
        ['t2', 1],
      ]);
      expect(mixed.total).toBe(2);
      // An entity type nobody holds yields an empty page, not the whole catalog.
      const none = await tags.list(query({ filters: { entityType: 'NOTE' } }));
      expect(none).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await uow.run(async () => {
        await tags.insert(tag('t1', 'Cliente clave', '2026-01-03T00:00:00.000Z'));
        await tags.insert(tag('t2', 'Árbol', '2026-01-01T00:00:00.000Z'));
        await tags.insert(tag('t3', 'beta', '2026-01-02T00:00:00.000Z'));
      });
    });

    it('sorts by name (case-insensitive) and by createdAt, with paging', async () => {
      const byName = await tags.list(query());
      expect(byName.items.map((r) => r.id)).toEqual(['t2', 't3', 't1']);
      const byCreated = await tags.list(
        query({ sort: { field: 'createdAt', direction: 'desc' }, pageSize: 25 }),
      );
      expect(byCreated.items.map((r) => r.id)).toEqual(['t1', 't3', 't2']);
      const second = await tags.list({ ...query(), page: 2, pageSize: 25 });
      expect(second).toMatchObject({ items: [], total: 3, page: 2, pageCount: 1 });
    });

    it('searches by name ignoring case and accents', async () => {
      expect((await tags.list(query({ q: 'CLIENTE' }))).items.map((r) => r.id)).toEqual(['t1']);
      expect((await tags.list(query({ q: 'arbol' }))).items.map((r) => r.id)).toEqual(['t2']);
      expect((await tags.list(query({ q: '100%' }))).total).toBe(0);
    });
  });
});
