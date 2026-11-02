import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ProjectListRequest } from '../application/ports/project.repository.port';
import type { ProjectRecord } from '../domain/project';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { projectEntryOf } from '../application/use-cases/project-sync';
import { PrismaProjectRepository } from './prisma-project.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaProjectRepository(host);

const ACTOR = 'usr_int';
const T = (iso: string) => new Date(iso);

async function makeClient(code: string, tradeName: string, legalName = `${tradeName} S.A.`) {
  return admin.client.create({
    data: {
      code,
      kind: 'EMPRESA',
      tradeName,
      legalName,
      taxId: `J-${code}`,
      country: 'VE',
      address: 'Test address',
      phone: '+58 000 0000',
    },
  });
}

const record = (n: number, over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: `int_pry_${n}`,
  code: `PRY-${String(n).padStart(4, '0')}`,
  name: `Proyecto ${n}`,
  summary: 'Resumen',
  description: null,
  descriptionText: null,
  status: 'PROPUESTA',
  startDate: null,
  targetEndDate: null,
  endDate: null,
  clients: [],
  technologyIds: [],
  links: [],
  createdAt: T('2026-01-01T00:00:00Z'),
  updatedAt: T('2026-01-01T00:00:00Z'),
  archivedAt: null,
  ...over,
});

const request = (over: Partial<ProjectListRequest> = {}): ProjectListRequest => ({
  filters: {},
  archived: 'exclude',
  sort: { field: 'code', direction: 'asc' },
  page: 1,
  pageSize: 25,
  ...over,
});

const codes = async (over: Partial<ProjectListRequest> = {}) =>
  (await repository.list(request(over))).records.map((r) => r.code);

let kairos: { id: string };
let tornillo: { id: string };

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
/** The catalog tables survive `truncateBusinessTables`; this file's technologies are slugged `int-*`. */
const cleanTechnologies = () =>
  admin.technology.deleteMany({ where: { slug: { startsWith: 'int-' } } });

beforeEach(async () => {
  await truncateBusinessTables(admin);
  await cleanTechnologies();
  kairos = await makeClient('CLI-0001', 'Kairós');
  tornillo = await makeClient('CLI-0002', 'Tornillo', 'Tornillería Nacional C.A.');
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await cleanTechnologies();
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaProjectRepository (int)', { timeout: 120_000 }, () => {
  it('inserts a project with its clients, stack and links and reads it back whole', async () => {
    const tech = await admin.technology.create({
      data: { name: 'Int Rust', slug: 'int-rust', category: 'LENGUAJE' },
    });
    const row = record(1, {
      description: { type: 'doc', content: [{ type: 'paragraph' }] },
      descriptionText: 'texto',
      status: 'EN_CURSO',
      startDate: '2026-02-01',
      targetEndDate: '2026-06-30',
      clients: [
        { clientId: tornillo.id, role: null, linkedAt: T('2026-01-02T00:00:00Z') },
        { clientId: kairos.id, role: 'Contratante', linkedAt: T('2026-01-01T00:00:00Z') },
      ],
      technologyIds: [tech.id],
      links: [
        { id: 'int_lnk_2', group: 'ENTORNO', label: 'Prod', url: 'https://p.test', order: 0 },
        { id: 'int_lnk_1', group: 'REPOSITORIO', label: 'Repo', url: 'https://r.test', order: 0 },
      ],
    });
    await uow.run(() => repository.insert(row, ACTOR));

    const found = await repository.findById(row.id);
    expect(found).toMatchObject({
      id: row.id,
      code: 'PRY-0001',
      description: row.description,
      status: 'EN_CURSO',
      startDate: '2026-02-01',
      targetEndDate: '2026-06-30',
      endDate: null,
      technologyIds: [tech.id],
      archivedAt: null,
    });
    // The earliest link comes first (Q-BE2-2).
    expect(found?.clients.map((c) => [c.clientId, c.role])).toEqual([
      [kairos.id, 'Contratante'],
      [tornillo.id, null],
    ]);
    expect(found?.links.map((l) => l.id)).toEqual(['int_lnk_1', 'int_lnk_2']);
    expect((await admin.project.findUnique({ where: { id: row.id } }))?.createdById).toBe(ACTOR);
    await expect(repository.findById('int_missing')).resolves.toBeNull();
  });

  it('refuses to write outside a unit of work', async () => {
    await expect(repository.insert(record(1), ACTOR)).rejects.toThrow(/unit of work/);
    await expect(repository.touch('x', ACTOR)).rejects.toThrow(/unit of work/);
    await expect(repository.setArchived(['x'], new Date(), ACTOR)).rejects.toThrow(/unit of work/);
  });

  it('rolls the insert back with the unit of work', async () => {
    await expect(
      uow.run(async () => {
        await repository.insert(
          record(1, { clients: [{ clientId: kairos.id, role: null, linkedAt: T('2026-01-01Z') }] }),
          ACTOR,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await admin.project.count()).toBe(0);
    expect(await admin.projectClient.count()).toBe(0);
  });

  it('updates the scalar columns, clearing the optional ones', async () => {
    await uow.run(() =>
      repository.insert(
        record(1, { description: { type: 'doc', content: [] }, startDate: '2026-02-01' }),
        ACTOR,
      ),
    );
    await uow.run(() =>
      repository.updateFields(
        record(1, { name: 'Renombrado', description: null, startDate: null, status: 'PAUSADO' }),
        'usr_other',
      ),
    );
    const found = await repository.findById('int_pry_1');
    expect(found).toMatchObject({
      name: 'Renombrado',
      description: null,
      startDate: null,
      // `updateFields` never writes the status (B3): a stale PATCH cannot undo a status change.
      status: 'PROPUESTA',
    });
    expect((await admin.project.findUnique({ where: { id: 'int_pry_1' } }))?.updatedById).toBe(
      'usr_other',
    );
  });

  it('updateStatus writes the status and its dates and nothing else', async () => {
    await uow.run(() => repository.insert(record(1), ACTOR));
    await uow.run(() =>
      repository.updateStatus(
        { id: 'int_pry_1', status: 'EN_CURSO', startDate: '2026-03-01', endDate: null },
        'usr_other',
      ),
    );
    expect(await repository.findById('int_pry_1')).toMatchObject({
      name: 'Proyecto 1',
      status: 'EN_CURSO',
      startDate: '2026-03-01',
      endDate: null,
    });
  });

  it('findByIdForUpdate needs a unit of work and answers like findById', async () => {
    await uow.run(() => repository.insert(record(1), ACTOR));
    await expect(repository.findByIdForUpdate('int_pry_1')).rejects.toThrow(/unit of work/);
    expect(await uow.run(() => repository.findByIdForUpdate('int_pry_1'))).toMatchObject({
      id: 'int_pry_1',
      status: 'PROPUESTA',
    });
    expect(await uow.run(() => repository.findByIdForUpdate('unknown'))).toBeNull();
  });

  it('replaces the clients: keeps the link instant of the ones kept, re-roles, removes and adds', async () => {
    const first = T('2026-01-01T00:00:00Z');
    await uow.run(() =>
      repository.insert(
        record(1, { clients: [{ clientId: kairos.id, role: 'Contratante', linkedAt: first }] }),
        ACTOR,
      ),
    );
    await uow.run(() =>
      repository.replaceClients('int_pry_1', [
        { clientId: kairos.id, role: 'Usuario final', linkedAt: T('2026-05-05T00:00:00Z') },
        { clientId: tornillo.id, role: null, linkedAt: T('2026-02-01T00:00:00Z') },
      ]),
    );
    let found = await repository.findById('int_pry_1');
    expect(found?.clients).toEqual([
      { clientId: kairos.id, role: 'Usuario final', linkedAt: first },
      { clientId: tornillo.id, role: null, linkedAt: T('2026-02-01T00:00:00Z') },
    ]);

    await uow.run(() =>
      repository.replaceClients('int_pry_1', [
        { clientId: tornillo.id, role: null, linkedAt: T('2026-02-01T00:00:00Z') },
      ]),
    );
    found = await repository.findById('int_pry_1');
    expect(found?.clients.map((c) => c.clientId)).toEqual([tornillo.id]);
  });

  it('replaces the stack and the links, deleting what is no longer listed', async () => {
    const [a, b] = await Promise.all(
      ['a', 'b'].map((s) =>
        admin.technology.create({ data: { name: `Int ${s}`, slug: `int-${s}`, category: 'OTRO' } }),
      ),
    );
    await uow.run(() =>
      repository.insert(
        record(1, {
          technologyIds: [a?.id ?? ''],
          links: [
            { id: 'l1', group: 'OTRO', label: 'uno', url: 'https://1.test', order: 0 },
            { id: 'l2', group: 'OTRO', label: 'dos', url: 'https://2.test', order: 1 },
          ],
        }),
        ACTOR,
      ),
    );
    await uow.run(async () => {
      await repository.replaceTechnologies('int_pry_1', [b?.id ?? '', b?.id ?? '']);
      await repository.replaceLinks('int_pry_1', [
        { id: 'l2', group: 'OTRO', label: 'dos!', url: 'https://2.test', order: 0 },
        { id: 'l3', group: 'ENTORNO', label: 'tres', url: 'https://3.test', order: 0 },
      ]);
    });
    const found = await repository.findById('int_pry_1');
    expect(found?.technologyIds).toEqual([b?.id]);
    expect(found?.links.map((l) => [l.id, l.label])).toEqual([
      ['l3', 'tres'],
      ['l2', 'dos!'],
    ]);
  });

  it('archives and restores, keeping archived rows out of the live counts', async () => {
    const tech = await admin.technology.create({
      data: { name: 'Int T', slug: 'int-t', category: 'OTRO' },
    });
    const link = { clientId: kairos.id, role: null, linkedAt: T('2026-01-01Z') };
    await uow.run(async () => {
      await repository.insert(record(1, { clients: [link], technologyIds: [tech.id] }), ACTOR);
      await repository.insert(record(2, { clients: [link], technologyIds: [tech.id] }), ACTOR);
    });
    expect(await repository.countLiveProjectsOfClient(kairos.id)).toBe(2);
    expect(await repository.countLiveByTechnology(tech.id)).toBe(2);

    const at = T('2026-03-01T10:00:00Z');
    await uow.run(() => repository.setArchived(['int_pry_1'], at, ACTOR));
    expect((await repository.findById('int_pry_1'))?.archivedAt).toEqual(at);
    expect((await admin.project.findUnique({ where: { id: 'int_pry_1' } }))?.deletedById).toBe(
      ACTOR,
    );
    expect(await repository.countLiveProjectsOfClient(kairos.id)).toBe(1);
    expect(await repository.countLiveByTechnology(tech.id)).toBe(1);

    await uow.run(() => repository.setArchived(['int_pry_1'], null, null));
    expect((await repository.findById('int_pry_1'))?.archivedAt).toBeNull();
    expect(
      (await admin.project.findUnique({ where: { id: 'int_pry_1' } }))?.deletedById,
    ).toBeNull();
    expect(await repository.countLiveProjectsOfClient(kairos.id)).toBe(2);
  });

  it('detaches a technology from archived projects only', async () => {
    const tech = await admin.technology.create({
      data: { name: 'Int D', slug: 'int-d', category: 'OTRO' },
    });
    await uow.run(async () => {
      await repository.insert(record(1, { technologyIds: [tech.id] }), ACTOR);
      await repository.insert(record(2, { technologyIds: [tech.id] }), ACTOR);
      await repository.setArchived(['int_pry_2'], T('2026-03-01Z'), ACTOR);
    });
    await expect(repository.detachTechnologyFromArchived(tech.id)).rejects.toThrow(/unit of work/);
    await uow.run(() => repository.detachTechnologyFromArchived(tech.id));
    expect((await repository.findById('int_pry_1'))?.technologyIds).toEqual([tech.id]);
    expect((await repository.findById('int_pry_2'))?.technologyIds).toEqual([]);
    // With the archived link gone the technology can be deleted (HU-06 CA3).
    await uow.run(() => repository.setArchived(['int_pry_1'], T('2026-03-02Z'), ACTOR));
    await uow.run(() => repository.detachTechnologyFromArchived(tech.id));
    await expect(admin.technology.delete({ where: { id: tech.id } })).resolves.toBeDefined();
  });

  it('lockClients needs a unit of work and holds the client rows until it ends', async () => {
    await expect(repository.lockClients([kairos.id])).rejects.toThrow(/unit of work/);
    const tryLock = () =>
      admin.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${kairos.id} FOR UPDATE NOWAIT`;
    await uow.run(async () => {
      await repository.lockClients([tornillo.id, kairos.id, kairos.id, 'unknown']);
      await expect(tryLock()).rejects.toThrow();
    });
    await expect(tryLock()).resolves.toHaveLength(1);
    await uow.run(() => repository.lockClients([]));
  });

  it('answers live client ids without the archived ones, and refs with them', async () => {
    await admin.client.update({ where: { id: tornillo.id }, data: { deletedAt: new Date() } });
    expect(await repository.liveClientIds([kairos.id, tornillo.id, 'ghost'])).toEqual([kairos.id]);
    const refs = await repository.clientRefs([kairos.id, tornillo.id, tornillo.id, 'ghost']);
    expect(refs.map((r) => [r.type, r.code, r.label]).sort()).toEqual([
      ['CLIENT', 'CLI-0001', 'Kairós'],
      ['CLIENT', 'CLI-0002', 'Tornillo'],
    ]);
    await expect(repository.clientRefs([])).resolves.toEqual([]);
  });

  describe('list', () => {
    const k = () => ({ clientId: kairos.id, role: null, linkedAt: T('2026-01-01Z') });
    const t = () => ({ clientId: tornillo.id, role: null, linkedAt: T('2026-01-01Z') });

    async function seed() {
      const tech = await admin.technology.create({
        data: { name: 'Int L', slug: 'int-l', category: 'OTRO' },
      });
      const tag = await admin.tag.create({ data: { name: 'Int tag', color: '#000000' } });
      await uow.run(async () => {
        await repository.insert(
          record(1, {
            name: 'Árbol de decisiones',
            status: 'EN_CURSO',
            targetEndDate: '2026-06-01',
            clients: [k()],
            technologyIds: [tech.id],
          }),
          ACTOR,
        );
        await repository.insert(
          record(2, {
            name: 'Zeta',
            status: 'PROPUESTA',
            targetEndDate: '2026-09-01',
            clients: [t()],
          }),
          ACTOR,
        );
        await repository.insert(
          record(3, { name: 'Beta', status: 'ENTREGADO', clients: [k(), t()] }),
          ACTOR,
        );
        await repository.insert(record(4, { name: 'Archivado', clients: [k()] }), ACTOR);
        await repository.setArchived(['int_pry_4'], T('2026-03-01Z'), ACTOR);
      });
      await uow.run(async () => {
        const search = new PrismaSearchIndex(host);
        for (const id of ['int_pry_1', 'int_pry_2', 'int_pry_3', 'int_pry_4']) {
          const stored = await repository.findById(id);
          if (stored) await search.upsert(await projectEntryOf(repository, stored));
        }
      });
      await admin.tagAssignment.create({ data: { tagId: tag.id, projectId: 'int_pry_2' } });
      return { tech, tag };
    }

    it('hides archived by default and honours only/include', async () => {
      await seed();
      expect(await codes()).toEqual(['PRY-0001', 'PRY-0002', 'PRY-0003']);
      expect(await codes({ archived: 'only' })).toEqual(['PRY-0004']);
      expect(await codes({ archived: 'include' })).toHaveLength(4);
      const page = await repository.list(request({ archived: 'include' }));
      expect(page.total).toBe(4);
    });

    it('filters by status, client, technology, tag and the delivery window (HU-06 CA2)', async () => {
      const { tech, tag } = await seed();
      expect(await codes({ filters: { status: ['EN_CURSO', 'ENTREGADO'] } })).toEqual([
        'PRY-0001',
        'PRY-0003',
      ]);
      expect(await codes({ filters: { clientIds: [tornillo.id] } })).toEqual([
        'PRY-0002',
        'PRY-0003',
      ]);
      expect(await codes({ filters: { clientIds: [kairos.id, tornillo.id] } })).toEqual([
        'PRY-0001',
        'PRY-0002',
        'PRY-0003',
      ]);
      expect(await codes({ filters: { technologyIds: [tech.id] } })).toEqual(['PRY-0001']);
      expect(await codes({ filters: { tagIds: [tag.id] } })).toEqual(['PRY-0002']);
      expect(await codes({ filters: { deliveryFrom: '2026-07-01' } })).toEqual(['PRY-0002']);
      expect(await codes({ filters: { deliveryTo: '2026-06-01' } })).toEqual(['PRY-0001']);
      expect(
        await codes({ filters: { deliveryFrom: '2026-06-01', deliveryTo: '2026-09-01' } }),
      ).toEqual(['PRY-0001', 'PRY-0002']);
    });

    it('withoutBillingPlan excludes projects with a plan and pages in SQL (Q-BE3-6)', async () => {
      await seed();
      await admin.billingPlan.create({
        data: {
          projectId: 'int_pry_1',
          model: 'PRECIO_FIJO',
          currency: 'USD',
          contractAmount: '100.00',
        },
      });
      expect(await codes({ filters: { withoutBillingPlan: true } })).toEqual([
        'PRY-0002',
        'PRY-0003',
      ]);
      expect(await codes({ filters: {} })).toEqual(['PRY-0001', 'PRY-0002', 'PRY-0003']);
      const page = await repository.list(
        request({ filters: { withoutBillingPlan: true }, pageSize: 1, page: 2 }),
      );
      expect(page.total).toBe(2);
      expect(page.records.map((r) => r.code)).toEqual(['PRY-0003']);
    });

    it('searches code, name and client names, accent- and case-insensitive, literal wildcards', async () => {
      await seed();
      expect(await codes({ filters: { q: 'arbol' } })).toEqual(['PRY-0001']);
      expect(await codes({ filters: { q: 'pry-0002' } })).toEqual(['PRY-0002']);
      expect(await codes({ filters: { q: 'KAIROS' } })).toEqual(['PRY-0001', 'PRY-0003']);
      // The legal name of a linked client counts too.
      expect(await codes({ filters: { q: 'tornilleria' } })).toEqual(['PRY-0002', 'PRY-0003']);
      expect(await codes({ filters: { q: '%' } })).toEqual([]);
      expect(await codes({ filters: { q: 'kairos', status: ['EN_CURSO'] } })).toEqual(['PRY-0001']);
      const page = await repository.list(request({ filters: { q: 'kairos' } }));
      expect(page.total).toBe(2);
    });

    it('sorts by name, status in enum order, dates with NULLs last, both directions', async () => {
      await seed();
      expect(await codes({ sort: { field: 'name', direction: 'asc' } })).toEqual([
        'PRY-0001', // Árbol (accent-folded)
        'PRY-0003', // Beta
        'PRY-0002', // Zeta
      ]);
      expect(await codes({ sort: { field: 'status', direction: 'asc' } })).toEqual([
        'PRY-0002', // PROPUESTA
        'PRY-0001', // EN_CURSO
        'PRY-0003', // ENTREGADO
      ]);
      expect(await codes({ sort: { field: 'targetEndDate', direction: 'asc' } })).toEqual([
        'PRY-0001',
        'PRY-0002',
        'PRY-0003',
      ]);
      expect(await codes({ sort: { field: 'targetEndDate', direction: 'desc' } })).toEqual([
        'PRY-0002',
        'PRY-0001',
        'PRY-0003',
      ]);
      expect(await codes({ sort: { field: 'code', direction: 'desc' } })).toEqual([
        'PRY-0003',
        'PRY-0002',
        'PRY-0001',
      ]);
    });

    it('sorts by the money columns of ProjectMetrics, a missing row counting as zero (Q-BE2-1)', async () => {
      await seed();
      await admin.projectMetrics.createMany({
        data: [
          { projectId: 'int_pry_1', contractedUsd: '500.00', toInvoiceUsd: '100.00' },
          { projectId: 'int_pry_2', contractedUsd: '1200.50', toInvoiceUsd: '0' },
        ],
      });
      expect(await codes({ sort: { field: 'contractedValueUsd', direction: 'desc' } })).toEqual([
        'PRY-0002',
        'PRY-0001',
        'PRY-0003',
      ]);
      expect(await codes({ sort: { field: 'toInvoiceUsd', direction: 'asc' } })).toEqual([
        'PRY-0002',
        'PRY-0003',
        'PRY-0001',
      ]);
      for (const field of ['invoicedUsd', 'collectedUsd']) {
        expect(await codes({ sort: { field, direction: 'asc' } })).toHaveLength(3);
      }
    });

    it('pages with a total and hydrates clients, stack and links in page order', async () => {
      await seed();
      const first = await repository.list(request({ pageSize: 2 }));
      expect(first.total).toBe(3);
      expect(first.records.map((r) => r.code)).toEqual(['PRY-0001', 'PRY-0002']);
      expect(first.records[0]?.clients).toHaveLength(1);
      expect(first.records[0]?.technologyIds).toHaveLength(1);
      const second = await repository.list(request({ pageSize: 2, page: 2 }));
      expect(second.records.map((r) => r.code)).toEqual(['PRY-0003']);
      expect(second.records[0]?.clients).toHaveLength(2);
      const beyond = await repository.list(request({ page: 9 }));
      expect(beyond).toEqual({ records: [], total: 3 });
    });

    it('rejects a sort key outside the map', async () => {
      await expect(
        repository.list(request({ sort: { field: 'nope', direction: 'asc' } })),
      ).rejects.toThrow(/sort map/);
    });
  });

  it('reads the metrics as decimal strings and omits projects without a row', async () => {
    await uow.run(async () => {
      await repository.insert(record(1), ACTOR);
      await repository.insert(record(2), ACTOR);
    });
    await admin.projectMetrics.create({
      data: {
        projectId: 'int_pry_1',
        contractedUsd: '1234.50',
        invoicedUsd: '100',
        collectedUsd: '0.10',
        toInvoiceUsd: '1134.40',
      },
    });
    const metrics = await repository.metricsFor(['int_pry_1', 'int_pry_2']);
    expect(metrics.get('int_pry_1')).toEqual({
      contractedValueUsd: '1234.50',
      invoicedUsd: '100.00',
      collectedUsd: '0.10',
      toInvoiceUsd: '1134.40',
    });
    expect(metrics.has('int_pry_2')).toBe(false);
  });
});
