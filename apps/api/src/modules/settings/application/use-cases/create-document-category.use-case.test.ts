import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { CreateDocumentCategory } from './create-document-category.use-case';

// Port of the create cases of fe/src/mocks/services/document-types.test.ts ("document categories").
function setup(policy?: Parameters<typeof createFixture>[0]) {
  const fixture = createFixture(policy);
  const useCase = new CreateDocumentCategory(
    fixture.authorization,
    fixture.uow,
    fixture.categories,
    fixture.catalog,
    fixture.ids,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

describe('CreateDocumentCategory', () => {
  it('appends the category after the last one and logs one SETTINGS_CHANGE', async () => {
    const { useCase, categories, activity } = setup();
    const created = await useCase.execute(actor('OWNER'), {
      name: 'Recursos humanos',
      nameEn: 'HR',
    });
    expect(created).toMatchObject({
      id: 'dnew_1',
      name: 'Recursos humanos',
      nameEn: 'HR',
      color: null,
      order: 5,
      types: [],
    });
    expect(categories.rows.at(-1)?.id).toBe('dnew_1');
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'dnew_1',
      entityLabel: 'Recursos humanos',
      changes: { documentCategory: [null, 'Recursos humanos'] },
    });
  });

  it('refuses a name already taken, case-insensitively, and writes nothing', async () => {
    const { useCase, categories, activity } = setup();
    const writesBefore = categories.writeCount;
    await expect(useCase.execute(actor('ADMIN'), { name: 'legal' })).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: [DOCUMENT_TYPE_MESSAGES.categoryNameTaken] },
    });
    expect(categories.writeCount).toBe(writesBefore);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a Member with FORBIDDEN and writes nothing', async () => {
    const { useCase, categories } = setup();
    await expect(useCase.execute(actor('MEMBER'), { name: 'Nueva' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(categories.writeCount).toBe(0);
  });
});
