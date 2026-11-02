import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../shared/application/current-user';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import type { DocumentListRow } from '../application/document-support';
import { DocumentsExportSource } from './documents-export-sources';

const actor: CurrentUser = {
  userId: 'usr_owner',
  clerkId: 'clerk_owner',
  role: 'OWNER',
  email: 'owner@example.test',
  name: 'Owner',
};

const row: DocumentListRow = {
  id: 'doc_1',
  code: 'DOC-0001',
  title: 'Contrato Kairos',
  category: { id: 'cat_1', name: 'Legal', nameEn: 'Legal', color: null },
  type: {
    id: 'typ_1',
    name: 'Contrato',
    nameEn: 'Contract',
    defaultFormat: 'ARCHIVO',
    requiresSignature: true,
    hasExpiration: true,
  },
  status: 'APROBADO',
  currentFormat: 'ARCHIVO',
  currentVersionNumber: 3,
  links: [
    { type: 'CLIENT', id: 'cli_1', label: 'Kairos' },
    { type: 'PROJECT', id: 'prj_1', label: 'Sitio' },
  ],
  expiresAt: '2027-01-31',
  isShared: true,
  tags: [],
  updatedAt: new Date('2026-10-30T12:00:00.000Z'),
  archivedAt: null,
};

function build(rows: readonly DocumentListRow[] = [row]) {
  const calls: unknown[] = [];
  const source = new DocumentsExportSource({
    execute: async (user: CurrentUser, query: ListQuery) => {
      calls.push({ user, query });
      return { items: rows, total: 41, page: query.page, pageSize: query.pageSize, totalPages: 2 };
    },
  } as never);
  return { source, calls };
}

describe('DocumentsExportSource (DT-171)', () => {
  it('is the "documents" entity', () => {
    expect(build().source.entity).toBe('documents');
  });

  it('whitelists exactly the columns of the documents table, none of them a file', () => {
    const ids = Object.keys(build().source.columns);
    expect(ids).toEqual([
      'code',
      'title',
      'category',
      'type',
      'status',
      'format',
      'versionNumber',
      'links',
      'expiresAt',
      'shared',
      'updatedAt',
    ]);
    // No File key: neither a column id nor a cell may expose storage keys, asset urls or file names.
    expect(ids.filter((id) => /file|storage|url|asset|path/i.test(id))).toEqual([]);
  });

  it('renders every cell from the list row, with no file data anywhere in it', () => {
    const { source } = build();
    const cells = Object.fromEntries(
      Object.entries(source.columns).map(([id, column]) => [id, column.value(row)]),
    );
    expect(cells).toEqual({
      code: 'DOC-0001',
      title: 'Contrato Kairos',
      category: 'Legal',
      type: 'Contrato',
      status: 'APROBADO',
      format: 'ARCHIVO',
      versionNumber: 3,
      links: 'Kairos; Sitio',
      expiresAt: '2027-01-31',
      shared: true,
      updatedAt: row.updatedAt,
    });
    expect(JSON.stringify(Object.keys(row))).not.toMatch(/file/i);
  });

  it('writes empty cells for a draft with no version, link or expiry', () => {
    const { source } = build();
    const bare: DocumentListRow = {
      ...row,
      currentFormat: null,
      currentVersionNumber: null,
      links: [],
      expiresAt: null,
      isShared: false,
    };
    expect(source.columns.format?.value(bare)).toBeNull();
    expect(source.columns.versionNumber?.value(bare)).toBeNull();
    expect(source.columns.links?.value(bare)).toBe('');
    expect(source.columns.expiresAt?.value(bare)).toBeNull();
    expect(source.columns.shared?.value(bare)).toBe(false);
  });

  it('reads through the list use case of the caller, so the export sees what the list shows', async () => {
    const { source, calls } = build();
    const query = { ...DEFAULT_LIST_QUERY, q: 'contrato', filters: { status: 'APROBADO' } };
    const { page, pageSize, ...rest } = query;
    void page;
    void pageSize;
    const result = await source.read(actor, rest, { page: 2, pageSize: 100 });
    expect(result).toEqual({ rows: [row], total: 41 });
    expect(calls).toEqual([{ user: actor, query: { ...rest, page: 2, pageSize: 100 } }]);
  });
});
