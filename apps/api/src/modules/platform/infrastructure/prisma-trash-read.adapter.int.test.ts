import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeClient,
  makeContact,
  makeDocument,
  makeInvoice,
  makeNote,
  makeProject,
  makeUser,
} from '../../../../test/db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { foldText } from '../../../shared/domain/list-query';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { TrashableEntityType } from '../application/ports/restore-handler.port';
import type { TrashReadQuery } from '../application/ports/trash-read.port';
import { PrismaTrashRead } from './prisma-trash-read.adapter';

const ALL: TrashableEntityType[] = ['CLIENT', 'CONTACT', 'PROJECT', 'NOTE', 'INVOICE', 'DOCUMENT'];
const base: TrashReadQuery = {
  entityTypes: ALL,
  sort: { field: 'deletedAt', direction: 'desc' },
  page: 1,
  pageSize: 25,
};
const at = (iso: string) => new Date(iso);

describe('PrismaTrashRead (int)', () => {
  const admin = createTestPrisma();
  let service: PrismaService;
  let trash: PrismaTrashRead;
  let archiver: { id: string; name: string };
  let other: { id: string; name: string };
  const ids = {} as Record<
    'client' | 'contact' | 'liveContact' | 'project' | 'note' | 'invoice' | 'doc' | 'live',
    string
  >;

  afterAll(async () => {
    await service.onModuleDestroy();
    await admin.$disconnect();
  });

  // The tests only read, so the archived rows are seeded once.
  beforeAll(async () => {
    service = new PrismaService({ DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL) });
    trash = new PrismaTrashRead(new TransactionHost(service));
    await truncateBusinessTables(admin);
    archiver = await makeUser(admin);
    other = await makeUser(admin);

    const client = await makeClient(admin);
    await admin.client.update({
      where: { id: client.id },
      data: {
        tradeName: 'Veredas Digital',
        deletedAt: at('2026-10-20T12:00:00Z'),
        deletedById: archiver.id,
      },
    });
    const live = await makeClient(admin);
    await admin.client.update({ where: { id: live.id }, data: { tradeName: 'Solaris Energía' } });

    // Contact has no deletedById: the archiver comes from the latest DELETE entry.
    const contact = await makeContact(admin, client.id);
    await admin.contact.update({
      where: { id: contact.id },
      data: { fullName: 'Ana Pérez', deletedAt: at('2026-10-20T12:00:00Z') },
    });
    await admin.activityLog.createMany({
      data: [
        {
          actorType: 'USER',
          actorId: other.id,
          action: 'DELETE',
          entityType: 'CONTACT',
          entityId: contact.id,
          entityLabel: 'Ana',
          createdAt: at('2026-10-19T10:00:00Z'),
        },
        {
          actorType: 'USER',
          actorId: archiver.id,
          action: 'DELETE',
          entityType: 'CONTACT',
          entityId: contact.id,
          entityLabel: 'Ana',
          createdAt: at('2026-10-20T12:00:00Z'),
        },
      ],
    });
    const liveContact = await makeContact(admin, live.id);

    const project = await makeProject(admin);
    await admin.project.update({
      where: { id: project.id },
      data: { name: 'Landing', deletedAt: at('2026-10-21T02:00:00Z'), deletedById: other.id },
    });
    await admin.projectClient.createMany({
      data: [
        { projectId: project.id, clientId: client.id },
        { projectId: project.id, clientId: live.id },
      ],
    });

    const note = await makeNote(admin);
    await admin.note.update({
      where: { id: note.id },
      data: {
        title: null,
        contentText: 'una nota con mas de seis palabras aqui',
        deletedAt: at('2026-10-18T09:00:00Z'),
        deletedById: archiver.id,
      },
    });

    const invoice = await makeInvoice(admin, live.id, { invoiceNumber: 'F-0001' });
    await admin.invoice.update({
      where: { id: invoice.id },
      data: { deletedAt: at('2026-10-17T09:00:00Z') },
    });
    await admin.activityLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'DELETE',
        entityType: 'INVOICE',
        entityId: invoice.id,
        entityLabel: 'F',
        createdAt: at('2026-10-17T09:00:00Z'),
      },
    });

    const doc = await makeDocument(admin);
    await admin.document.update({
      where: { id: doc.id },
      data: {
        title: 'Contrato Marco',
        deletedAt: at('2026-10-16T09:00:00Z'),
        deletedById: archiver.id,
      },
    });
    await makeDocument(admin); // live

    Object.assign(ids, {
      client: client.id,
      contact: contact.id,
      liveContact: liveContact.id,
      project: project.id,
      note: note.id,
      invoice: invoice.id,
      doc: doc.id,
      live: live.id,
    });
  }, 60_000);

  it('unions the archived rows of the six tables, newest first, and never the live ones', async () => {
    const page = await trash.list(base);
    expect(page.items.map((r) => r.entity.id)).toEqual([
      ids.project,
      ids.client,
      ids.contact,
      ids.note,
      ids.invoice,
      ids.doc,
    ]);
    expect(page.total).toBe(6);
    expect(page.pageCount).toBe(1);
    expect(page.items.map((r) => r.entity.id)).not.toContain(ids.liveContact);
  });

  it('maps entity refs and context per type', async () => {
    const byId = new Map((await trash.list(base)).items.map((r) => [r.entity.id, r]));
    expect(byId.get(ids.client)).toMatchObject({
      entity: { type: 'CLIENT', label: 'Veredas Digital' },
      context: null,
    });
    expect(byId.get(ids.client)?.entity.code).toBeTruthy();
    expect(byId.get(ids.contact)).toMatchObject({
      entity: { type: 'CONTACT', label: 'Ana Pérez' },
      context: 'Veredas Digital',
    });
    expect(byId.get(ids.contact)?.entity.code).toBeUndefined();
    expect(byId.get(ids.project)).toMatchObject({
      entity: { type: 'PROJECT', label: 'Landing' },
      context: 'Solaris Energía, Veredas Digital',
    });
    expect(byId.get(ids.note)?.entity).toMatchObject({
      type: 'NOTE',
      label: 'una nota con mas de seis',
    });
    expect(byId.get(ids.invoice)).toMatchObject({
      entity: { type: 'INVOICE', label: 'F-0001' },
      context: 'Solaris Energía',
    });
    expect(byId.get(ids.doc)).toMatchObject({
      entity: { type: 'DOCUMENT', label: 'Contrato Marco' },
      context: expect.any(String),
    });
    expect(byId.get(ids.client)?.deletedAt).toEqual(at('2026-10-20T12:00:00Z'));
  });

  it('resolves who archived: deletedById, else the latest DELETE entry of a USER, else null', async () => {
    const byId = new Map((await trash.list(base)).items.map((r) => [r.entity.id, r]));
    expect(byId.get(ids.client)?.deletedBy).toEqual({
      id: archiver.id,
      name: archiver.name,
      imageUrl: null,
    });
    expect(byId.get(ids.project)?.deletedBy?.id).toBe(other.id);
    expect(byId.get(ids.contact)?.deletedBy?.id).toBe(archiver.id);
    expect(byId.get(ids.invoice)?.deletedBy).toBeNull();
  });

  it('limits to the requested types and filters by archiver', async () => {
    expect(
      (await trash.list({ ...base, entityTypes: ['PROJECT'] })).items.map((r) => r.entity.id),
    ).toEqual([ids.project]);
    const mine = await trash.list({ ...base, deletedById: [archiver.id] });
    expect(mine.items.map((r) => r.entity.id).sort()).toEqual(
      [ids.client, ids.contact, ids.note, ids.doc].sort(),
    );
    expect((await trash.list({ ...base, deletedById: ['nobody'] })).total).toBe(0);
  });

  it('filters by Caracas day, inclusive on both ends', async () => {
    // 2026-10-21T02:00Z is still 2026-10-20 in Caracas (UTC-4).
    const day = await trash.list({ ...base, deletedFrom: '2026-10-20', deletedTo: '2026-10-20' });
    expect(day.items.map((r) => r.entity.id).sort()).toEqual(
      [ids.client, ids.contact, ids.project].sort(),
    );
    const later = await trash.list({ ...base, deletedFrom: '2026-10-21' });
    expect(later.total).toBe(0);
    const earlier = await trash.list({ ...base, deletedTo: '2026-10-17' });
    expect(earlier.items.map((r) => r.entity.id).sort()).toEqual([ids.invoice, ids.doc].sort());
  });

  it('searches label, code and context, ignoring case and accents', async () => {
    expect(
      (await trash.list({ ...base, q: 'VEREDAS' })).items.map((r) => r.entity.id).sort(),
    ).toEqual([ids.client, ids.contact, ids.project].sort());
    expect((await trash.list({ ...base, q: 'perez' })).items.map((r) => r.entity.id)).toEqual([
      ids.contact,
    ]);
    expect(
      (await trash.list({ ...base, q: 'solaris energia' })).items.map((r) => r.entity.id).sort(),
    ).toEqual([ids.project, ids.invoice].sort());
    expect((await trash.list({ ...base, q: 'F-0001' })).total).toBe(1);
    expect((await trash.list({ ...base, q: '100%' })).total).toBe(0);
  });

  it('sorts by label and entityType, with a stable id tie-break, and pages', async () => {
    const byLabel = await trash.list({ ...base, sort: { field: 'label', direction: 'asc' } });
    expect(byLabel.items.map((r) => r.entity.label)).toEqual(
      [...byLabel.items.map((r) => r.entity.label)].sort((a, b) =>
        foldText(a) < foldText(b) ? -1 : 1,
      ),
    );
    const byType = await trash.list({ ...base, sort: { field: 'entityType', direction: 'asc' } });
    expect(byType.items.map((r) => r.entity.type)).toEqual([
      'CLIENT',
      'CONTACT',
      'DOCUMENT',
      'INVOICE',
      'NOTE',
      'PROJECT',
    ]);
    const second = await trash.list({ ...base, pageSize: 25, page: 2 });
    expect(second).toMatchObject({ items: [], total: 6, page: 2 });
  });
});
