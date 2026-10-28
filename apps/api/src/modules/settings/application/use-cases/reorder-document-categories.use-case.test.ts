import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { ReorderDocumentCategories } from './reorder-document-categories.use-case';

// Port of the reorder case of fe/src/mocks/services/document-types.test.ts ("document categories").
function setup() {
  const fixture = createFixture();
  const useCase = new ReorderDocumentCategories(
    fixture.authorization,
    fixture.uow,
    fixture.categories,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

const SEED_IDS = [
  'dcat_legal',
  'dcat_comercial',
  'dcat_tecnico',
  'dcat_operativo',
  'dcat_financiero',
];

describe('ReorderDocumentCategories', () => {
  it('takes every id in the new order, renumbers from 0 and logs the new name order', async () => {
    const { useCase, activity, categories } = setup();
    const reversed = [...SEED_IDS].reverse();
    const result = await useCase.execute(actor('OWNER'), { orderedIds: reversed });
    expect(result.map((row) => row.id)).toEqual(reversed);
    expect(result.map((row) => row.order)).toEqual([0, 1, 2, 3, 4]);
    expect(categories.rows.map((row) => row.id)).toEqual(reversed);
    expect(activity.entries.at(-1)?.changes).toEqual({
      documentCategoryOrder: [
        'Legal, Comercial, Técnico, Operativo, Financiero',
        'Financiero, Operativo, Técnico, Comercial, Legal',
      ],
    });
  });

  it('refuses a list that is not the full set, all or nothing, with VALIDATION on orderedIds', async () => {
    const { useCase, categories, activity } = setup();
    const before = categories.writeCount;
    await expect(
      useCase.execute(actor('OWNER'), { orderedIds: SEED_IDS.slice(1) }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { orderedIds: [DOCUMENT_TYPE_MESSAGES.reorderMismatch] },
    });
    expect(categories.writeCount).toBe(before);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses an unknown id in place of a known one', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('ADMIN'), { orderedIds: [...SEED_IDS.slice(1), 'dcat_nope'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('MEMBER'), { orderedIds: SEED_IDS })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
