import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../../shared/application/current-user';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { ClientListRow } from '../domain/client';
import type { ContactView } from '../domain/contact';
import type { ProjectListRowView } from '../domain/project';
import type { NoteListRow } from '../application/use-cases/note-support';
import {
  ClientExportSource,
  ContactExportSource,
  NoteExportSource,
  ProjectExportSource,
} from './commercial-export-sources';

const actor: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'user_1',
  role: 'ADMIN',
  email: 'a@example.test',
  name: 'Admin',
};
const query: Omit<ListQuery, 'page' | 'pageSize'> = {
  sort: { field: 'code', direction: 'asc' },
  q: 'kairos',
  archived: 'exclude',
  filters: { status: ['ACTIVO'] },
};
const page = { items: [] as never[], total: 7, page: 2, pageSize: 100 as const, pageCount: 1 };
const cell = <Row>(
  source: { columns: Readonly<Record<string, { value: (r: Row) => unknown }>> },
  id: string,
  row: Row,
) => source.columns[id]?.value(row);

describe('ClientExportSource', () => {
  it('is the CLIENT table and reads through the client list with the caller and the page', async () => {
    const execute = vi.fn(async () => ({ ...page, items: [] }));
    const source = new ClientExportSource({ execute });
    expect(source.entity).toBe('CLIENT');
    expect(await source.read(actor, query, { page: 2, pageSize: 100 })).toEqual({
      rows: [],
      total: 7,
    });
    expect(execute).toHaveBeenCalledWith(actor, { ...query, page: 2, pageSize: 100 });
  });

  it('writes the list cells; the money cells stay null for a caller without financials', () => {
    const row = {
      client: {
        code: 'CLI-0001',
        tradeName: 'Kairos',
        legalName: 'Kairos C.A.',
        taxId: 'J-1',
        country: 'VE',
        kind: 'EMPRESA',
        status: 'ACTIVO',
        email: null,
        phone: '+58',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      projectCount: 3,
      lastActivityAt: null,
      totalInvoicedUsd: null,
      receivableUsd: '10.00',
      tags: [{ id: 't', name: 'VIP', color: '#000000' }],
    } as unknown as ClientListRow;
    const source = new ClientExportSource({ execute: vi.fn() });
    expect(cell(source, 'code', row)).toBe('CLI-0001');
    expect(cell(source, 'tradeName', row)).toBe('Kairos');
    expect(cell(source, 'projectCount', row)).toBe(3);
    expect(cell(source, 'totalInvoicedUsd', row)).toBeNull();
    expect(cell(source, 'receivableUsd', row)).toBe('10.00');
    expect(cell(source, 'tags', row)).toBe('VIP');
    expect(Object.keys(source.columns)).not.toContain('deletedAt');
  });
});

describe('ContactExportSource', () => {
  it('is the CONTACT table of one client: clientId is required', async () => {
    const execute = vi.fn(async () => ({ ...page, items: [] }));
    const source = new ContactExportSource({ execute });
    expect(source.entity).toBe('CONTACT');
    await expect(source.read(actor, query, { page: 1, pageSize: 100 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await source.read(
      actor,
      { ...query, filters: { clientId: 'cli_a' } },
      { page: 1, pageSize: 100 },
    );
    expect(execute).toHaveBeenCalledWith(actor, {
      clientId: 'cli_a',
      query: { ...query, filters: { clientId: 'cli_a' }, page: 1, pageSize: 100 },
    });
  });

  it('writes the contact cells', () => {
    const row = {
      contact: {
        fullName: 'Ana',
        position: 'CTO',
        email: 'ana@k.example',
        phone: '+58',
        isPrimary: true,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      tags: [],
    } as unknown as ContactView;
    const source = new ContactExportSource({ execute: vi.fn() });
    expect(cell(source, 'fullName', row)).toBe('Ana');
    expect(cell(source, 'isPrimary', row)).toBe(true);
  });
});

describe('ProjectExportSource', () => {
  it('is the PROJECT table and writes client labels joined and money only when present', async () => {
    const execute = vi.fn(async () => ({ ...page, items: [] }));
    const source = new ProjectExportSource({ execute });
    expect(source.entity).toBe('PROJECT');
    await source.read(actor, query, { page: 1, pageSize: 100 });
    expect(execute).toHaveBeenCalledWith(actor, { ...query, page: 1, pageSize: 100 });
    const row = {
      code: 'PRY-0001',
      name: 'Web',
      clients: [
        { client: { id: 'a', label: 'Kairos' }, role: null },
        { client: { id: 'b', label: 'Tornillo' }, role: null },
      ],
      status: 'EN_CURSO',
      startDate: '2026-01-01',
      targetEndDate: null,
      stack: [{ name: 'Rust' }, { name: 'React' }],
      tags: [],
      contractedValueUsd: null,
      invoicedUsd: '5.00',
    } as unknown as ProjectListRowView;
    expect(cell(source, 'clients', row)).toBe('Kairos; Tornillo');
    expect(cell(source, 'stack', row)).toBe('Rust; React');
    expect(cell(source, 'contractedValueUsd', row)).toBeNull();
    expect(cell(source, 'invoicedUsd', row)).toBe('5.00');
  });
});

describe('NoteExportSource', () => {
  it('is the NOTE table and writes the excerpt, never the rich content', async () => {
    const execute = vi.fn(async () => ({ ...page, items: [] }));
    const source = new NoteExportSource({ execute });
    expect(source.entity).toBe('NOTE');
    await source.read(actor, query, { page: 1, pageSize: 100 });
    expect(execute).toHaveBeenCalledWith(actor, { ...query, page: 1, pageSize: 100 });
    const row = {
      id: 'n',
      title: null,
      excerpt: 'Resumen',
      author: { id: 'u', name: 'Ana', imageUrl: null },
      pinned: true,
      tags: [{ name: 'VIP' }],
      links: [{ label: 'Kairos' }],
      attachmentCount: 2,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
      archivedAt: null,
    } as unknown as NoteListRow;
    expect(cell(source, 'excerpt', row)).toBe('Resumen');
    expect(cell(source, 'title', row)).toBe('Resumen');
    expect(cell(source, 'author', row)).toBe('Ana');
    expect(cell(source, 'links', row)).toBe('Kairos');
    expect(cell(source, 'attachments', row)).toBe(2);
    expect(Object.keys(source.columns)).not.toContain('content');
  });
});
