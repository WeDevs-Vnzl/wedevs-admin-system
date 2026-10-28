import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import { DeleteDocumentType } from './delete-document-type.use-case';

// Port of the delete cases of fe/src/mocks/services/document-types.test.ts ("document types", HU-21 CA2).
function setup() {
  const fixture = createFixture();
  const useCase = new DeleteDocumentType(
    fixture.authorization,
    fixture.uow,
    fixture.types,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

describe('DeleteDocumentType', () => {
  it('removes an unused type for good and logs the removal', async () => {
    const { useCase, types, activity, catalog } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: 'dtyp_propuesta' })).resolves.toEqual({
      id: 'dtyp_propuesta',
    });
    expect(types.rows.map((row) => row.id)).not.toContain('dtyp_propuesta');
    await expect(catalog.requireType('dtyp_propuesta')).rejects.toBeInstanceOf(NotFoundError);
    expect(activity.entries.at(-1)?.changes).toEqual({
      documentType: ['Propuesta', null],
    });
  });

  it('locks the delete of a type in use, even by archived documents (INTEGRITY_LOCK, HU-21 CA2)', async () => {
    const { useCase, types, usage } = setup();
    usage.setCount('dtyp_contrato', 1);
    const before = types.writeCount;
    const error = await useCase
      .execute(actor('OWNER'), { id: 'dtyp_contrato' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityLockedError);
    expect((error as IntegrityLockedError).message).toBe(DOCUMENT_TYPE_MESSAGES.typeInUse);
    expect(types.rows.map((row) => row.id)).toContain('dtyp_contrato');
    expect(types.writeCount).toBe(before);
  });

  it('answers NOT_FOUND for an unknown id and FORBIDDEN for a Member', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: 'dtyp_nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(useCase.execute(actor('MEMBER'), { id: 'dtyp_propuesta' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
