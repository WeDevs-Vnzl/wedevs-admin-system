import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { UpdateDocumentType } from './update-document-type.use-case';

// Port of the update case of fe/src/mocks/services/document-types.test.ts ("document types").
function setup() {
  const fixture = createFixture();
  const useCase = new UpdateDocumentType(
    fixture.authorization,
    fixture.uow,
    fixture.types,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

const full = {
  id: 'dtyp_adenda',
  categoryId: 'dcat_tecnico',
  name: 'Adenda técnica',
  nameEn: 'Technical addendum',
  requiresSignature: false,
  hasExpiration: true,
  defaultFormat: 'ENLACE' as const,
  active: true,
};

describe('UpdateDocumentType', () => {
  it('edits every field, moves the type to another category and logs the diff', async () => {
    const { useCase, activity, types } = setup();
    const updated = await useCase.execute(actor('OWNER'), full);
    expect(updated).toMatchObject({
      name: 'Adenda técnica',
      nameEn: 'Technical addendum',
      requiresSignature: false,
      hasExpiration: true,
      defaultFormat: 'ENLACE',
      category: { id: 'dcat_tecnico' },
    });
    expect(types.rows.find((row) => row.id === 'dtyp_adenda')?.categoryId).toBe('dcat_tecnico');
    expect(activity.entries.at(-1)?.changes).toEqual({
      categoryId: ['dcat_legal', 'dcat_tecnico'],
      name: ['Adenda', 'Adenda técnica'],
      nameEn: ['Addendum', 'Technical addendum'],
      requiresSignature: [true, false],
      hasExpiration: [false, true],
      defaultFormat: ['ARCHIVO', 'ENLACE'],
    });
  });

  it('answers NOT_FOUND for an unknown id, CONFLICT for a name taken in the target category', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...full, id: 'dtyp_nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const error = await useCase
      .execute(actor('OWNER'), { ...full, categoryId: 'dcat_legal', name: 'CONTRATO DE SERVICIOS' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      name: [DOCUMENT_TYPE_MESSAGES.typeNameTaken],
    });
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('MEMBER'), full)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
