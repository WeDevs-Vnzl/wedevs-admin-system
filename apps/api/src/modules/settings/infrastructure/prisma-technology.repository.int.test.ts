import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import type { TechnologyRecord } from '../domain/technology';
import { ConflictError, IntegrityLockedError } from '../../../shared/domain/domain-error';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { PrismaTechnologyRepository } from './prisma-technology.repository';

/** Every row this file creates has a slug starting with `int-`, so the seeded catalog is never touched. */
const PREFIX = 'int-';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaTechnologyRepository(host);

const record = (suffix: string, overrides: Partial<TechnologyRecord> = {}): TechnologyRecord => ({
  id: `int_tec_${suffix}`,
  name: `Int Tech ${suffix}`,
  nameEn: null,
  slug: `${PREFIX}${suffix}`,
  category: 'BACKEND',
  iconSlug: null,
  color: null,
  active: true,
  ...overrides,
});

async function cleanup(): Promise<void> {
  await admin.project.deleteMany({ where: { code: { startsWith: 'INTTEC' } } });
  await admin.technology.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await service.client.$disconnect();
  await admin.$disconnect();
});

// Generous suite budget: the database round trips share a loaded machine (see the e2e suite).
describe('PrismaTechnologyRepository (int)', { timeout: 120_000 }, () => {
  it('inserts a row and reads it back with every field, nulls included', async () => {
    const row = record('a', { nameEn: 'English', iconSlug: 'nestjs', color: '#E0234E' });
    await uow.run(() => repository.insert(row));
    await expect(repository.findById(row.id)).resolves.toEqual(row);
  });

  it('answers null for an unknown id', async () => {
    await expect(repository.findById('int_tec_missing')).resolves.toBeNull();
  });

  it('lists every technology, and only the ids asked for by findByIds', async () => {
    const a = record('b');
    const b = record('c', { active: false });
    await uow.run(async () => {
      await repository.insert(a);
      await repository.insert(b);
    });
    const all = await repository.findAll();
    expect(all.map((t) => t.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const some = await repository.findByIds([b.id, 'int_tec_missing']);
    expect(some).toEqual([b]);
    await expect(repository.findByIds([])).resolves.toEqual([]);
  });

  it('replaces every stored value of the row on update', async () => {
    const row = record('d');
    await uow.run(() => repository.insert(row));
    const changed: TechnologyRecord = {
      ...row,
      name: 'Int Tech renamed',
      nameEn: 'Renamed',
      slug: `${PREFIX}renamed`,
      category: 'IA',
      iconSlug: 'openai',
      color: '#10A37F',
      active: false,
    };
    await uow.run(() => repository.update(changed));
    await expect(repository.findById(row.id)).resolves.toEqual(changed);
  });

  it('translates a duplicate name into ConflictError on the name field', async () => {
    await uow.run(() => repository.insert(record('e')));
    const error = await uow
      .run(() => repository.insert(record('f', { name: 'Int Tech e' })))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      name: ['catalogs.technologies.errors.nameTaken'],
    });
  });

  it('translates a duplicate slug into ConflictError on the slug field', async () => {
    await uow.run(() => repository.insert(record('g')));
    const error = await uow
      .run(() => repository.insert(record('h', { slug: `${PREFIX}g` })))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      slug: ['catalogs.technologies.errors.slugTaken'],
    });
  });

  it('deletes an unused technology', async () => {
    const row = record('i');
    await uow.run(() => repository.insert(row));
    await uow.run(() => repository.delete(row.id));
    await expect(repository.findById(row.id)).resolves.toBeNull();
  });

  it('refuses to delete a technology that a project still lists: IntegrityLockedError, row kept', async () => {
    const row = record('j');
    await uow.run(() => repository.insert(row));
    await admin.project.create({
      data: { id: 'int_prj_j', code: 'INTTEC-1', name: 'Int project', summary: 'Int' },
    });
    await admin.projectTechnology.create({
      data: { projectId: 'int_prj_j', technologyId: row.id },
    });
    const error = await uow.run(() => repository.delete(row.id)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntegrityLockedError);
    await expect(repository.findById(row.id)).resolves.toEqual(row);
  });

  it('discards an insert when the unit of work rolls back', async () => {
    const row = record('k');
    await expect(
      uow.run(async () => {
        await repository.insert(row);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(repository.findById(row.id)).resolves.toBeNull();
  });
});
