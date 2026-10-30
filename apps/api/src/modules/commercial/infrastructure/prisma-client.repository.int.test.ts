import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeProject } from '../../../../test/db/helpers';
import { clientRecord } from '../../../../test/commercial/clients/fixtures';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { DEFAULT_LIST_QUERY } from '../../../shared/domain/list-query';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ClientListQuery } from '../application/ports/client.repository.port';
import type { ClientRecord } from '../domain/client';
import { PrismaClientRepository } from './prisma-client.repository';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const clients = new PrismaClientRepository(host);
const uow = new PrismaUnitOfWork(host);

const listQuery = (over: Partial<ClientListQuery> = {}): ClientListQuery => ({
  page: 1,
  pageSize: DEFAULT_LIST_QUERY.pageSize,
  sort: { field: 'code', direction: 'asc' },
  archived: 'exclude',
  ...over,
});

const insert = (over: Partial<ClientRecord> = {}) => {
  const record = clientRecord(over);
  return uow.run(() => clients.insert(record)).then(() => record);
};

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

describe('PrismaClientRepository (int)', () => {
  it('inserts, reads and updates a client and refuses to write outside a unit of work', async () => {
    const record = clientRecord({ id: 'cli_a', code: 'CLI-0001', email: 'a@b.example.com' });
    await expect(clients.insert(record)).rejects.toThrow(/unit of work/);
    await uow.run(() => clients.insert(record));
    expect(await clients.findById('cli_a')).toEqual(record);
    expect(await clients.findById('missing')).toBeNull();

    const updated = {
      ...record,
      tradeName: 'Nuevo',
      status: 'ACTIVO' as const,
      activatedAt: new Date(),
    };
    await uow.run(() => clients.update(updated));
    expect(await clients.findById('cli_a')).toMatchObject({
      tradeName: 'Nuevo',
      status: 'ACTIVO',
      activatedAt: updated.activatedAt,
    });
  });

  it('archives with the actor and restores, keeping the archived row readable by id', async () => {
    const user = await admin.user.create({
      data: { clerkId: 'u1', email: 'u1@example.test', name: 'U1' },
    });
    const record = await insert();
    const at = new Date('2026-02-01T10:00:00.000Z');
    await uow.run(() => clients.archive(record.id, at, user.id));
    const archived = await clients.findById(record.id);
    expect(archived?.deletedAt).toEqual(at);
    expect((await admin.client.findUniqueOrThrow({ where: { id: record.id } })).deletedById).toBe(
      user.id,
    );

    await uow.run(() => clients.restore(record.id, new Date('2026-02-02T10:00:00.000Z')));
    const restored = await admin.client.findUniqueOrThrow({ where: { id: record.id } });
    expect(restored).toMatchObject({ deletedAt: null, deletedById: null });
  });

  describe('tax id uniqueness', () => {
    it('finds the live holder comparing the normalized key within the country', async () => {
      const kairos = await insert({ taxId: 'J-30123456-7', country: 'VE' });
      const abroad = await insert({ taxId: '900.123.456-1', country: 'CO' });

      expect((await clients.findTaxIdHolder('j301234567', 'VE'))?.id).toBe(kairos.id);
      expect((await clients.findTaxIdHolder(' J-30123456-7 ', 'VE'))?.id).toBe(kairos.id);
      expect(await clients.findTaxIdHolder('J-30123456-7', 'CO')).toBeNull();
      expect((await clients.findTaxIdHolder('900 123 456 1', 'CO'))?.id).toBe(abroad.id);
      expect(await clients.findTaxIdHolder('J-30123456-7', 'VE', kairos.id)).toBeNull();
    });

    it('ignores archived clients', async () => {
      const gone = await insert({ taxId: 'J-30123456-7' });
      await uow.run(() => clients.archive(gone.id, new Date(), 'whoever'));
      expect(await clients.findTaxIdHolder('J-30123456-7', 'VE')).toBeNull();
    });

    it('maps a lost race on the partial unique to CONFLICT duplicateTaxId', async () => {
      await insert({ taxId: 'J-30123456-7' });
      await expect(insert({ taxId: 'J-30123456-7' })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'clients.errors.duplicateTaxId',
      });
      const other = await insert({ taxId: 'J-30123456-8' });
      await expect(
        uow.run(() => clients.update({ ...other, taxId: 'J-30123456-7' })),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('lets the same tax id come back after the holder is archived, and refuses its restore', async () => {
      const first = await insert({ taxId: 'J-30123456-7' });
      await uow.run(() => clients.archive(first.id, new Date(), 'whoever'));
      await insert({ taxId: 'J-30123456-7' });
      await expect(uow.run(() => clients.restore(first.id, new Date()))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('hasActiveProjects', () => {
    async function link(clientId: string, status: string, archived = false) {
      const project = await makeProject(admin);
      await admin.project.update({
        where: { id: project.id },
        data: { status: status as 'EN_CURSO', deletedAt: archived ? new Date() : null },
      });
      await admin.projectClient.create({ data: { projectId: project.id, clientId } });
    }

    it('is true for a live project in progress and false for delivered, cancelled or archived ones', async () => {
      const a = await insert();
      const b = await insert();
      const c = await insert();
      const d = await insert();
      await link(a.id, 'EN_CURSO');
      await link(b.id, 'ENTREGADO');
      await link(b.id, 'CANCELADO');
      await link(c.id, 'EN_CURSO', true);
      for (const [id, expected] of [
        [a.id, true],
        [b.id, false],
        [c.id, false],
        [d.id, false],
      ] as const) {
        expect(await clients.hasActiveProjects(id)).toBe(expected);
      }
      for (const status of ['PROPUESTA', 'PAUSADO', 'MANTENIMIENTO']) {
        const e = await insert();
        await link(e.id, status);
        expect(await clients.hasActiveProjects(e.id)).toBe(true);
      }
    });
  });

  describe('list', () => {
    it('pages live clients and hides the archived ones by default', async () => {
      for (let i = 0; i < 3; i++) await insert();
      const gone = await insert();
      await uow.run(() => clients.archive(gone.id, new Date(), 'whoever'));

      const page = await clients.list(listQuery({ pageSize: 2 }));
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2, pageCount: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.items.every((row) => row.client.deletedAt === null)).toBe(true);
      expect(page.items[0]).toMatchObject({
        projectCount: 0,
        lastActivityAt: null,
        totalInvoicedUsd: '0.00',
        receivableUsd: '0.00',
      });
      expect(
        (await clients.list(listQuery({ archived: 'only' }))).items.map((r) => r.client.id),
      ).toEqual([gone.id]);
      expect((await clients.list(listQuery({ archived: 'include' }))).total).toBe(4);
    });

    it('applies the status, kind, country, tag, created range and search filters', async () => {
      const kairos = await insert({
        tradeName: 'Kairos Studio',
        taxId: 'J-30123456-7',
        status: 'ACTIVO',
        createdAt: new Date('2026-03-10T15:00:00.000Z'),
      });
      const person = await insert({
        kind: 'PERSONA',
        country: 'CO',
        taxId: 'CC 1',
        status: 'INACTIVO',
      });
      await insert({ tradeName: 'Zafiro Labs', email: 'hola@zafiro.example.com' });
      const tag = await admin.tag.create({ data: { name: 'VIP', color: '#112233' } });
      await admin.tagAssignment.create({ data: { tagId: tag.id, clientId: kairos.id } });

      const ids = async (over: Partial<ClientListQuery>) =>
        (await clients.list(listQuery(over))).items.map((row) => row.client.id);

      expect(await ids({ status: ['ACTIVO', 'INACTIVO'] })).toEqual([kairos.id, person.id].sort());
      expect(await ids({ kind: ['PERSONA'] })).toEqual([person.id]);
      expect(await ids({ country: ['CO'] })).toEqual([person.id]);
      expect(await ids({ tagIds: [tag.id] })).toEqual([kairos.id]);
      expect(await ids({ createdFrom: '2026-03-10', createdTo: '2026-03-10' })).toEqual([
        kairos.id,
      ]);
      // 2026-03-10T15:00Z is still the 10th in Caracas (UTC-4); the 11th starts at 04:00Z.
      expect(await ids({ createdFrom: '2026-03-11' })).not.toContain(kairos.id);
      expect(await ids({ q: 'KAIROS' })).toEqual([kairos.id]);
      expect(await ids({ q: '30123456' })).toEqual([kairos.id]);
      expect(await ids({ q: 'zafiro.example' })).toHaveLength(1);
      expect(await ids({ q: 'kairos', status: ['INACTIVO'] })).toEqual([]);
    });

    it('reads projectCount, lastActivityAt and the money columns from ClientMetrics', async () => {
      const a = await insert({ tradeName: 'Alfa' });
      const b = await insert({ tradeName: 'Beta' });
      const lone = await insert({ tradeName: 'Sin fila' });
      const at = new Date('2026-04-01T00:00:00.000Z');
      await admin.clientMetrics.create({
        data: {
          clientId: a.id,
          projectCount: 2,
          lastActivityAt: at,
          invoicedUsd: '120.50',
          receivableUsd: '80',
          overdueUsd: '80',
        },
      });
      await admin.clientMetrics.create({
        data: { clientId: b.id, receivableUsd: '300.10', invoicedUsd: '300.10' },
      });

      const page = await clients.list(
        listQuery({ sort: { field: 'receivableUsd', direction: 'desc' } }),
      );
      expect(page.items.map((row) => row.client.id)).toEqual([b.id, a.id, lone.id]);
      expect(page.items[0]).toMatchObject({ receivableUsd: '300.10', totalInvoicedUsd: '300.10' });
      expect(page.items[1]).toMatchObject({
        projectCount: 2,
        lastActivityAt: at,
        totalInvoicedUsd: '120.50',
        receivableUsd: '80.00',
      });
      // The client without a metrics row reads as zero, never as missing.
      expect(page.items[2]).toMatchObject({
        projectCount: 0,
        lastActivityAt: null,
        totalInvoicedUsd: '0.00',
        receivableUsd: '0.00',
      });

      const ids = async (over: Partial<ClientListQuery>) =>
        (await clients.list(listQuery(over))).items.map((row) => row.client.id);
      expect(await ids({ hasOverdue: true })).toEqual([a.id]);
      expect(await ids({ hasOverdue: false })).toEqual([b.id, lone.id].sort());
      expect(await ids({ sort: { field: 'receivableUsd', direction: 'asc' } })).toEqual([
        lone.id,
        a.id,
        b.id,
      ]);
      expect(await ids({ sort: { field: 'projectCount', direction: 'desc' } })).toEqual([
        a.id,
        ...[b.id, lone.id].sort(),
      ]);
      expect((await ids({ sort: { field: 'lastActivityAt', direction: 'asc' } }))[0]).toBe(a.id);
      expect((await ids({ sort: { field: 'lastActivityAt', direction: 'desc' } }))[0]).toBe(a.id);
    });

    it('sorts text keys ignoring case and accents, with the id as tie-breaker', async () => {
      const z = await insert({ tradeName: 'zeta' });
      const a = await insert({ tradeName: 'Álamo' });
      const b = await insert({ tradeName: 'beta' });
      const asc = await clients.list(listQuery({ sort: { field: 'tradeName', direction: 'asc' } }));
      expect(asc.items.map((row) => row.client.id)).toEqual([a.id, b.id, z.id]);
      for (const field of ['code', 'kind', 'country', 'status', 'createdAt']) {
        const page = await clients.list(listQuery({ sort: { field, direction: 'desc' } }));
        expect(page.total).toBe(3);
      }
    });
  });

  describe('search', () => {
    it('returns live clients by trade name, at most the limit, matching code, names and tax id', async () => {
      const kairos = await insert({ tradeName: 'Kairos Studio', taxId: 'J-30123456-7' });
      await insert({ tradeName: 'Zafiro Labs' });
      const gone = await insert({ tradeName: 'Veredas Digital' });
      await uow.run(() => clients.archive(gone.id, new Date(), 'whoever'));

      expect((await clients.search(undefined, 20)).map((c) => c.tradeName)).toEqual([
        'Kairos Studio',
        'Zafiro Labs',
      ]);
      expect((await clients.search('kairos', 20)).map((c) => c.id)).toEqual([kairos.id]);
      expect((await clients.search('30123456', 20)).map((c) => c.id)).toEqual([kairos.id]);
      expect(await clients.search('veredas', 20)).toEqual([]);
      expect(await clients.search(undefined, 1)).toHaveLength(1);
    });
  });
});
