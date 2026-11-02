import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientRecord, contactRecord } from '../../../../test/commercial/clients/fixtures';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { contactSearchEntry, type ContactRecord } from '../domain/contact';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { PrismaClientRepository } from './prisma-client.repository';
import { PrismaContactRepository } from './prisma-contact.repository';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const clients = new PrismaClientRepository(host);
const contacts = new PrismaContactRepository(host);
const uow = new PrismaUnitOfWork(host);

const query = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_LIST_QUERY, ...over });

async function newClient() {
  const record = clientRecord();
  await uow.run(() => clients.insert(record));
  return record;
}

const searchIndex = new PrismaSearchIndex(host);

async function newContact(clientId: string, over: Partial<ContactRecord> = {}) {
  const record = contactRecord(clientId, over);
  await uow.run(async () => {
    await contacts.insert(record);
    await searchIndex.upsert(contactSearchEntry(record));
  });
  return record;
}

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

describe('PrismaContactRepository (int)', () => {
  it('inserts, reads and updates a contact and refuses to write outside a unit of work', async () => {
    const client = await newClient();
    const record = contactRecord(client.id, { phone: '+584121234567', position: 'CTO' });
    await expect(contacts.insert(record)).rejects.toThrow(/unit of work/);
    await uow.run(() => contacts.insert(record));
    expect(await contacts.findById(record.id)).toEqual(record);
    expect(await contacts.findById('missing')).toBeNull();

    await uow.run(() =>
      contacts.update({ ...record, fullName: 'Nueva', position: null, updatedAt: new Date() }),
    );
    expect(await contacts.findById(record.id)).toMatchObject({ fullName: 'Nueva', position: null });
  });

  describe('one primary per client (contact_one_primary)', () => {
    it('refuses a second live primary with CONFLICT and allows one per client', async () => {
      const a = await newClient();
      const b = await newClient();
      await newContact(a.id, { isPrimary: true });
      await newContact(b.id, { isPrimary: true });
      await expect(newContact(a.id, { isPrimary: true })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      const second = await newContact(a.id);
      await expect(
        uow.run(() => contacts.update({ ...second, isPrimary: true })),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('lists the other live primaries of the client', async () => {
      const client = await newClient();
      const primary = await newContact(client.id, { isPrimary: true });
      const plain = await newContact(client.id);
      expect((await contacts.findOtherPrimaries(client.id, plain.id)).map((c) => c.id)).toEqual([
        primary.id,
      ]);
      expect(await contacts.findOtherPrimaries(client.id, primary.id)).toEqual([]);
      expect(await contacts.findOtherPrimaries(client.id, null)).toHaveLength(1);
    });

    it('archiving a contact releases the primary flag so another can take it', async () => {
      const client = await newClient();
      const primary = await newContact(client.id, { isPrimary: true });
      await uow.run(() => contacts.archive(primary.id, new Date('2026-02-01T00:00:00.000Z')));
      expect(await contacts.findById(primary.id)).toMatchObject({ isPrimary: false });
      expect((await contacts.findById(primary.id))?.deletedAt).not.toBeNull();
      await newContact(client.id, { isPrimary: true });
    });
  });

  describe('client cascade', () => {
    it('archives the live contacts with one deletedAt, keeping the primary flag, and revives only that cut', async () => {
      const client = await newClient();
      const primary = await newContact(client.id, { isPrimary: true });
      const other = await newContact(client.id);
      const lone = await newContact(client.id);
      await uow.run(() => contacts.archive(lone.id, new Date('2026-02-01T00:00:00.000Z')));

      const at = new Date('2026-03-01T00:00:00.000Z');
      const cascaded = await uow.run(() => contacts.archiveLiveOfClient(client.id, at));
      expect(cascaded.map((c) => [c.id, c.isPrimary]).sort()).toEqual(
        [
          [primary.id, true],
          [other.id, false],
        ].sort(),
      );
      expect(cascaded.every((c) => c.deletedAt?.getTime() === at.getTime())).toBe(true);
      expect(await contacts.findLiveByClient(client.id)).toEqual([]);

      const cut = await contacts.findArchivedAt(client.id, at);
      expect(cut.map((c) => c.id).sort()).toEqual([primary.id, other.id].sort());
      await uow.run(() =>
        contacts.restoreMany(
          cut.map((c) => c.id),
          new Date('2026-03-02T00:00:00.000Z'),
        ),
      );
      const live = await contacts.findLiveByClient(client.id);
      expect(live.map((c) => c.id).sort()).toEqual([primary.id, other.id].sort());
      expect(live.find((c) => c.id === primary.id)?.isPrimary).toBe(true);
      expect((await contacts.findById(lone.id))?.deletedAt).not.toBeNull();
    });

    it('returns nothing and writes nothing for a client without live contacts', async () => {
      const client = await newClient();
      expect(await uow.run(() => contacts.archiveLiveOfClient(client.id, new Date()))).toEqual([]);
      await uow.run(() => contacts.restoreMany([], new Date()));
    });
  });

  describe('list', () => {
    it('lists one client contacts, primary first by default, and hides the archived', async () => {
      const client = await newClient();
      const other = await newClient();
      await newContact(other.id, { fullName: 'Ajena' });
      const zoe = await newContact(client.id, { fullName: 'Zoe' });
      const ana = await newContact(client.id, { fullName: 'Ana', isPrimary: true });
      const gone = await newContact(client.id, { fullName: 'Borrada' });
      await uow.run(() => contacts.archive(gone.id, new Date()));

      const page = await contacts.list(
        client.id,
        query({ sort: { field: 'isPrimary', direction: 'desc' } }),
      );
      expect(page.total).toBe(2);
      expect(page.items.map((c) => c.id)).toEqual([ana.id, zoe.id]);
      expect(
        (await contacts.list(client.id, query({ archived: 'only', sort: null }))).items.map(
          (c) => c.id,
        ),
      ).toEqual([gone.id]);
      expect(await contacts.list(other.id, query({ q: 'ana' }))).toMatchObject({ total: 0 });
    });

    it('searches name, position, e-mail and phone ignoring case and accents, and sorts', async () => {
      const client = await newClient();
      const maria = await newContact(client.id, { fullName: 'María López', email: 'maria@k.test' });
      const cto = await newContact(client.id, {
        fullName: 'Bruno',
        position: 'CTO',
        email: null,
        phone: '+584121234567',
      });
      const byName = await contacts.list(client.id, query({ q: 'maria', sort: null }));
      expect(byName.items.map((c) => c.id)).toEqual([maria.id]);
      expect(
        (await contacts.list(client.id, query({ q: 'cto', sort: null }))).items.map((c) => c.id),
      ).toEqual([cto.id]);
      expect((await contacts.list(client.id, query({ q: '4121234567', sort: null }))).total).toBe(
        1,
      );

      const sorted = await contacts.list(
        client.id,
        query({ sort: { field: 'position', direction: 'asc' } }),
      );
      expect(sorted.items.map((c) => c.id)).toEqual([cto.id, maria.id]);
      for (const field of ['fullName', 'email', 'isPrimary', 'createdAt']) {
        expect(
          (await contacts.list(client.id, query({ sort: { field, direction: 'desc' } }))).total,
        ).toBe(2);
      }
    });
  });

  describe('search', () => {
    it('returns live contacts of live clients, primary first, optionally of one client', async () => {
      const kairos = await newClient();
      const zafiro = await newClient();
      const archived = await newClient();
      const ana = await newContact(kairos.id, { fullName: 'Ana Kairos' });
      const bruno = await newContact(kairos.id, { fullName: 'Bruno Kairos', isPrimary: true });
      const zoe = await newContact(zafiro.id, { fullName: 'Zoe Zafiro' });
      await newContact(archived.id, { fullName: 'Oculta' });
      await uow.run(() => clients.archive(archived.id, new Date(), 'whoever'));
      const gone = await newContact(kairos.id, { fullName: 'Borrada' });
      await uow.run(() => contacts.archive(gone.id, new Date()));

      expect((await contacts.search(undefined, undefined, 20)).map((c) => c.id)).toEqual([
        bruno.id,
        ana.id,
        zoe.id,
      ]);
      expect((await contacts.search('zafiro', undefined, 20)).map((c) => c.id)).toEqual([zoe.id]);
      expect((await contacts.search(undefined, kairos.id, 20)).map((c) => c.id)).toEqual([
        bruno.id,
        ana.id,
      ]);
      expect(await contacts.search('oculta', undefined, 20)).toEqual([]);
      expect(await contacts.search(undefined, undefined, 1)).toHaveLength(1);
    });
  });

  it('finds the live contacts of a client', async () => {
    const client = await newClient();
    const a = await newContact(client.id);
    expect((await contacts.findLiveByClient(client.id)).map((c) => c.id)).toEqual([a.id]);
  });
});
