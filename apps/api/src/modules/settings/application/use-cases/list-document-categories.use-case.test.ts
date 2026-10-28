import { describe, expect, it } from 'vitest';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { ListDocumentCategories } from './list-document-categories.use-case';

// Reads of reference catalogs carry `@Authenticated()` (DT-71): any signed-in role reads them.
describe('ListDocumentCategories', () => {
  it('returns every category in order, with its types, for any signed-in role', async () => {
    const { catalog } = createFixture();
    const useCase = new ListDocumentCategories(catalog);
    for (const role of ['VIEWER', 'MEMBER'] as const) {
      const rows = await useCase.execute(actor(role));
      expect(rows.map((row) => row.order)).toEqual([0, 1, 2, 3, 4]);
      expect(rows[0]?.types.map((t) => t.id)).toEqual(['dtyp_adenda', 'dtyp_contrato']);
    }
  });
});
