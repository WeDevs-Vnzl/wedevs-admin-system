import { describe, expect, it } from 'vitest';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { ListDocumentTypes, type DocumentTypeListQuery } from './list-document-types.use-case';

// Port of the list cases of fe/src/mocks/services/document-types.test.ts and of the filters and sort of
// fe/src/lib/validators/document-types.ts (`listRows` of fe/src/mocks/services/list.ts).
const BASE: DocumentTypeListQuery = {
  page: 1,
  pageSize: 25,
  sort: { field: 'name', direction: 'asc' },
};

function list(query: Partial<DocumentTypeListQuery>, usageCounts: Record<string, number> = {}) {
  const fixture = createFixture();
  for (const [typeId, count] of Object.entries(usageCounts)) fixture.usage.setCount(typeId, count);
  return new ListDocumentTypes(fixture.catalog).execute(actor('VIEWER'), { ...BASE, ...query });
}

describe('ListDocumentTypes', () => {
  it('lists every type by name with its category, paged with the total', async () => {
    const page = await list({ pageSize: 2 });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2, pageCount: 2 });
    expect(page.items.map((row) => row.name)).toEqual(['Adenda', 'Contrato de servicios']);
    expect(page.items[0]?.category).toEqual({
      id: 'dcat_legal',
      name: 'Legal',
      nameEn: 'Legal',
      color: '#6d28d9',
    });
    const second = await list({ pageSize: 2, page: 2 });
    expect(second.items.map((row) => row.name)).toEqual(['Propuesta']);
  });

  it('filters by active, by categories, by requiresSignature and by hasExpiration', async () => {
    expect((await list({ active: false })).items.map((row) => row.id)).toEqual(['dtyp_propuesta']);
    expect((await list({ categoryId: ['dcat_comercial'] })).items.map((row) => row.id)).toEqual([
      'dtyp_propuesta',
    ]);
    expect((await list({ requiresSignature: true })).items.map((row) => row.id)).toEqual([
      'dtyp_adenda',
      'dtyp_contrato',
    ]);
    expect((await list({ hasExpiration: true })).items.map((row) => row.id)).toEqual([
      'dtyp_contrato',
    ]);
  });

  it('searches name, English name and category name, accent- and case-insensitively', async () => {
    expect((await list({ q: 'CONTRATO' })).items.map((row) => row.id)).toEqual(['dtyp_contrato']);
    expect((await list({ q: 'addend' })).items.map((row) => row.id)).toEqual(['dtyp_adenda']);
    expect((await list({ q: 'legal' })).items.map((row) => row.id)).toEqual([
      'dtyp_adenda',
      'dtyp_contrato',
    ]);
    expect((await list({ q: 'tecnico' })).total).toBe(0);
  });

  it('sorts by documentCount and by category name, ties broken by name', async () => {
    const counts = { dtyp_contrato: 4, dtyp_adenda: 1, dtyp_propuesta: 2 };
    expect(
      (await list({ sort: { field: 'documentCount', direction: 'desc' } }, counts)).items.map(
        (row) => row.id,
      ),
    ).toEqual(['dtyp_contrato', 'dtyp_propuesta', 'dtyp_adenda']);
    expect(
      (await list({ sort: { field: 'category', direction: 'asc' } })).items.map((row) => row.id),
    ).toEqual(['dtyp_propuesta', 'dtyp_adenda', 'dtyp_contrato']);
  });

  it('returns an empty page past the end, with the total still counted', async () => {
    const page = await list({ page: 3, pageSize: 25 });
    expect(page).toMatchObject({ items: [], total: 3, page: 3, pageCount: 1 });
  });
});
