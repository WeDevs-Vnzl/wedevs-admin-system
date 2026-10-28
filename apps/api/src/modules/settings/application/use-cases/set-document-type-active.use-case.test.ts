import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { SetDocumentTypeActive } from './set-document-type-active.use-case';

// Port of the activation case of fe/src/mocks/services/document-types.test.ts ("document types").
function setup() {
  const fixture = createFixture();
  const useCase = new SetDocumentTypeActive(
    fixture.authorization,
    fixture.uow,
    fixture.types,
    fixture.catalog,
    fixture.activity,
  );
  return { ...fixture, useCase };
}

describe('SetDocumentTypeActive', () => {
  it('deactivates and reactivates a type, logging each real change', async () => {
    const { useCase, activity, types } = setup();
    await expect(
      useCase.execute(actor('ADMIN'), { id: 'dtyp_contrato', active: false }),
    ).resolves.toMatchObject({ id: 'dtyp_contrato', active: false });
    expect(types.rows.find((row) => row.id === 'dtyp_contrato')?.active).toBe(false);
    await expect(
      useCase.execute(actor('ADMIN'), { id: 'dtyp_contrato', active: true }),
    ).resolves.toMatchObject({ active: true });
    expect(activity.entries.map((e) => e.changes)).toEqual([
      { active: [true, false] },
      { active: [false, true] },
    ]);
  });

  it('writes nothing when the flag is already set', async () => {
    const { useCase, activity, types } = setup();
    const before = types.writeCount;
    await useCase.execute(actor('OWNER'), { id: 'dtyp_contrato', active: true });
    expect(types.writeCount).toBe(before);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown id and FORBIDDEN for a Viewer', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { id: 'dtyp_nope', active: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      useCase.execute(actor('VIEWER'), { id: 'dtyp_contrato', active: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
