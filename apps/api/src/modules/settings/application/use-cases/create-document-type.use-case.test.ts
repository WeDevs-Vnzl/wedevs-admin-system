import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationFailedError,
} from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { CreateDocumentType } from './create-document-type.use-case';

// Port of the create cases of fe/src/mocks/services/document-types.test.ts ("document types", HU-21 CA1).
function setup() {
  const fixture = createFixture();
  const useCase = new CreateDocumentType(
    fixture.authorization,
    fixture.uow,
    fixture.types,
    fixture.catalog,
    fixture.ids,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

const base = {
  categoryId: 'dcat_legal',
  name: 'Poder notarial',
  nameEn: null,
  requiresSignature: true,
  hasExpiration: true,
  defaultFormat: 'MARKDOWN' as const,
  active: true,
};

describe('CreateDocumentType', () => {
  it('creates a type inside a category with its capabilities and logs it (HU-21 CA1)', async () => {
    const { useCase, types, activity } = setup();
    const created = await useCase.execute(actor('ADMIN'), base);
    expect(created).toMatchObject({
      id: 'dnew_1',
      name: 'Poder notarial',
      nameEn: null,
      requiresSignature: true,
      hasExpiration: true,
      defaultFormat: 'MARKDOWN',
      active: true,
      documentCount: 0,
      category: { id: 'dcat_legal', name: 'Legal' },
    });
    expect(types.rows.map((row) => row.id)).toContain('dnew_1');
    expect(activity.entries.at(-1)).toMatchObject({
      entityType: 'SETTING',
      entityId: 'dnew_1',
      changes: { documentType: [null, 'Poder notarial'] },
    });
  });

  it('refuses an unknown category (VALIDATION) and a name taken inside the same category (CONFLICT)', async () => {
    const { useCase, types } = setup();
    const before = types.writeCount;
    await expect(
      useCase.execute(actor('OWNER'), { ...base, categoryId: 'dcat_missing' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { categoryId: [DOCUMENT_TYPE_MESSAGES.unknownCategory] },
    });
    const error = await useCase
      .execute(actor('OWNER'), { ...base, name: 'adenda', categoryId: 'dcat_legal' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      name: [DOCUMENT_TYPE_MESSAGES.typeNameTaken],
    });
    expect(types.writeCount).toBe(before);
  });

  it('accepts the same name in another category', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...base, name: 'Adenda', categoryId: 'dcat_tecnico' }),
    ).resolves.toMatchObject({ name: 'Adenda', category: { id: 'dcat_tecnico' } });
  });

  it('refuses an invalid default format and a Member with the matching errors', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...base, defaultFormat: 'PDF' as 'ARCHIVO' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(useCase.execute(actor('MEMBER'), base)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
