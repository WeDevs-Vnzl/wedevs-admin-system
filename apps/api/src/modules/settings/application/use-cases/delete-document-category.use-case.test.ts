import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { DeleteDocumentCategory } from './delete-document-category.use-case';

// Port of the delete cases of fe/src/mocks/services/document-types.test.ts ("document categories").
function setup() {
  const fixture = createFixture();
  const useCase = new DeleteDocumentCategory(
    fixture.authorization,
    fixture.uow,
    fixture.categories,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

describe('DeleteDocumentCategory', () => {
  it('removes an empty category for good, renumbers the rest and logs the removal', async () => {
    const { useCase, categories, activity } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: 'dcat_financiero' })).resolves.toEqual({
      id: 'dcat_financiero',
    });
    expect(categories.rows.map((row) => row.id)).not.toContain('dcat_financiero');
    expect(categories.rows.map((row) => row.order)).toEqual([0, 1, 2, 3]);
    expect(activity.entries.at(-1)?.changes).toEqual({ documentCategory: ['Financiero', null] });
  });

  it('locks the delete of a category that has types (INTEGRITY_LOCK) and removes nothing', async () => {
    const { useCase, categories } = setup();
    const before = categories.writeCount;
    const error = await useCase
      .execute(actor('OWNER'), { id: 'dcat_legal' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityLockedError);
    expect((error as IntegrityLockedError).message).toBe(DOCUMENT_TYPE_MESSAGES.categoryHasTypes);
    expect(categories.rows.map((row) => row.id)).toContain('dcat_legal');
    expect(categories.writeCount).toBe(before);
  });

  it('answers NOT_FOUND for an unknown id and FORBIDDEN for a Viewer', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: 'dcat_nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      useCase.execute(actor('VIEWER'), { id: 'dcat_financiero' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
