import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { UpdateDocumentCategory } from './update-document-category.use-case';

// Port of the update case of fe/src/mocks/services/document-types.test.ts ("document categories").
function setup() {
  const fixture = createFixture();
  const useCase = new UpdateDocumentCategory(
    fixture.authorization,
    fixture.uow,
    fixture.categories,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

describe('UpdateDocumentCategory', () => {
  it('edits name, English name and colour, keeps the order and the types, and logs the diff', async () => {
    const { useCase, activity, categories } = setup();
    const updated = await useCase.execute(actor('OWNER'), {
      id: 'dcat_legal',
      name: 'Jurídico',
      nameEn: undefined,
      color: '#112233',
    });
    expect(updated).toMatchObject({
      name: 'Jurídico',
      nameEn: null,
      color: '#112233',
      order: 0,
    });
    expect(updated.types.map((t) => t.id)).toEqual(['dtyp_adenda', 'dtyp_contrato']);
    expect(categories.rows[0]).toMatchObject({ name: 'Jurídico', order: 0 });
    expect(activity.entries.at(-1)?.changes).toEqual({
      name: ['Legal', 'Jurídico'],
      nameEn: ['Legal', null],
      color: ['#6d28d9', '#112233'],
    });
  });

  it('writes no activity entry when nothing changed', async () => {
    const { useCase, activity } = setup();
    await useCase.execute(actor('ADMIN'), {
      id: 'dcat_legal',
      name: 'Legal',
      nameEn: 'Legal',
      color: '#6d28d9',
    });
    expect(activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown id and CONFLICT for a name taken by another category', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { id: 'dcat_missing', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      useCase.execute(actor('OWNER'), { id: 'dcat_legal', name: 'COMERCIAL' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: [DOCUMENT_TYPE_MESSAGES.categoryNameTaken] },
    });
  });

  it('refuses a Viewer with FORBIDDEN', async () => {
    const { useCase, categories } = setup();
    const before = categories.writeCount;
    await expect(
      useCase.execute(actor('VIEWER'), { id: 'dcat_legal', name: 'Jurídico' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(categories.writeCount).toBe(before);
  });
});
