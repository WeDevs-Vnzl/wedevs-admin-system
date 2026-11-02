import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientRecord, contactRecord } from '../../../../test/commercial/clients/fixtures';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { clientSearchEntry } from '../domain/client';
import { contactSearchEntry } from '../domain/contact';
import { noteSearchEntry } from '../application/use-cases/note-support';
import { projectEntryOf } from '../application/use-cases/project-sync';
import {
  ClientReindexSource,
  ContactReindexSource,
  NoteReindexSource,
  ProjectReindexSource,
} from './commercial-reindex-sources';
import { PrismaClientRepository } from './prisma-client.repository';
import { PrismaContactRepository } from './prisma-contact.repository';
import { PrismaNoteRepository } from './prisma-note.repository';
import { PrismaProjectRepository } from './prisma-project.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const clients = new PrismaClientRepository(host);
const contacts = new PrismaContactRepository(host);
const projects = new PrismaProjectRepository(host);
const notes = new PrismaNoteRepository(host);

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const GONE = new Date('2026-03-01T00:00:00.000Z');

describe('ClientReindexSource', () => {
  const source = new ClientReindexSource(host, clients);

  it('pages ids ascending after the cursor, archived clients included', async () => {
    for (const id of ['cli_c', 'cli_a', 'cli_b']) {
      await uow.run(() =>
        clients.insert(clientRecord({ id, code: `CLI-${id}`, taxId: `J-${id}` })),
      );
    }
    await admin.client.update({ where: { id: 'cli_b' }, data: { deletedAt: GONE } });
    expect(source.entityType).toBe('CLIENT');
    expect(await source.pageIds(null, 2)).toEqual(['cli_a', 'cli_b']);
    expect(await source.pageIds('cli_b', 10)).toEqual(['cli_c']);
  });

  it('builds the entry the write path builds, with the e-mail and the archived flag', async () => {
    const live = clientRecord({ id: 'cli_a', code: 'CLI-1', email: 'a@k.example.com' });
    const gone = clientRecord({ id: 'cli_b', code: 'CLI-2', taxId: 'J-2' });
    await uow.run(async () => {
      await clients.insert(live);
      await clients.insert(gone);
    });
    await admin.client.update({ where: { id: 'cli_b' }, data: { deletedAt: GONE } });
    expect(await source.entryOf('cli_a')).toEqual(clientSearchEntry(live));
    expect((await source.entryOf('cli_a'))?.body).toContain('a@k.example.com');
    expect(await source.entryOf('cli_b')).toMatchObject({ archived: true });
    expect(await source.entryOf('missing')).toBeNull();
  });
});

describe('ContactReindexSource', () => {
  const source = new ContactReindexSource(host, contacts);

  it('pages ascending including archived contacts and builds the contact entry', async () => {
    await uow.run(() => clients.insert(clientRecord({ id: 'cli_a', code: 'CLI-1' })));
    const live = contactRecord('cli_a', { id: 'con_b', fullName: 'Bruno', position: 'CTO' });
    const gone = contactRecord('cli_a', { id: 'con_a', fullName: 'Ana' });
    await uow.run(async () => {
      await contacts.insert(live);
      await contacts.insert(gone);
    });
    await admin.contact.update({ where: { id: 'con_a' }, data: { deletedAt: GONE } });
    expect(source.entityType).toBe('CONTACT');
    expect(await source.pageIds(null, 10)).toEqual(['con_a', 'con_b']);
    expect(await source.entryOf('con_b')).toEqual(contactSearchEntry(live));
    expect(await source.entryOf('con_a')).toMatchObject({ archived: true });
    expect(await source.entryOf('missing')).toBeNull();
  });
});

describe('ProjectReindexSource', () => {
  const source = new ProjectReindexSource(host, projects);

  it('builds the project entry with the clients names, legal names included, archived too', async () => {
    await uow.run(async () => {
      await clients.insert(
        clientRecord({
          id: 'cli_a',
          code: 'CLI-1',
          tradeName: 'Kairos',
          legalName: 'Tornillería Kairos C.A.',
        }),
      );
    });
    const base = {
      description: null,
      descriptionText: null,
      startDate: null,
      targetEndDate: null,
      endDate: null,
      technologyIds: [],
      links: [],
      status: 'PROPUESTA' as const,
      summary: 'Resumen',
      createdAt: GONE,
      updatedAt: GONE,
      clients: [{ clientId: 'cli_a', role: 'Contratante', linkedAt: GONE }],
    };
    await uow.run(async () => {
      await projects.insert(
        { ...base, id: 'pry_b', code: 'PRY-2', name: 'Beta', archivedAt: null },
        'usr',
      );
      await projects.insert(
        { ...base, id: 'pry_a', code: 'PRY-1', name: 'Alfa', archivedAt: null },
        'usr',
      );
    });
    await admin.project.update({ where: { id: 'pry_a' }, data: { deletedAt: GONE } });
    expect(source.entityType).toBe('PROJECT');
    expect(await source.pageIds(null, 10)).toEqual(['pry_a', 'pry_b']);
    const entry = await source.entryOf('pry_b');
    expect(entry).toMatchObject({
      entityType: 'PROJECT',
      code: 'PRY-2',
      title: 'Beta',
      subtitle: 'Kairos',
      body: 'Tornillería Kairos C.A.\nResumen',
      archived: false,
    });
    const stored = await projects.findById('pry_b');
    expect(entry).toEqual(stored ? await projectEntryOf(projects, stored) : null);
    expect(await source.entryOf('pry_a')).toMatchObject({ archived: true });
    expect(await source.entryOf('missing')).toBeNull();
  });
});

describe('NoteReindexSource', () => {
  const source = new NoteReindexSource(host, notes);

  it('pages ascending including archived notes and builds the note entry', async () => {
    const user = await admin.user.create({
      data: { clerkId: 'user_ri', email: 'ri@example.test', name: 'A', role: 'OWNER' },
    });
    const doc = (text: string) => ({
      type: 'doc' as const,
      content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
    });
    const make = (id: string, title: string | null, text: string) => ({
      id,
      title,
      content: doc(text),
      contentText: text,
      authorId: user.id,
      pinned: false,
      links: [],
      attachmentFileIds: [],
      createdAt: GONE,
    });
    await uow.run(async () => {
      await notes.insert(make('not_b', 'Reunión', 'Texto de la reunión'));
      await notes.insert(make('not_a', null, 'Sin título'));
    });
    await uow.run(() => notes.archive('not_a', GONE, user.id));
    expect(source.entityType).toBe('NOTE');
    expect(await source.pageIds(null, 10)).toEqual(['not_a', 'not_b']);
    expect(await source.entryOf('not_b')).toEqual(
      noteSearchEntry(make('not_b', 'Reunión', 'Texto de la reunión'), false),
    );
    expect(await source.entryOf('not_a')).toMatchObject({ archived: true, body: 'Sin título' });
    expect(await source.entryOf('missing')).toBeNull();
  });
});
