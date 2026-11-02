import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from '../document-type-catalog';
import type { DocumentTypeSearchDependentsPort } from '../ports/document-type-search-dependents.port';
import { UpdateDocumentType } from './update-document-type.use-case';

// Port of the update case of fe/src/mocks/services/document-types.test.ts ("document types").
/** Records the relabels and the order against the activity log; `failWith` makes the relabel throw. */
class FakeDependents implements DocumentTypeSearchDependentsPort {
  readonly calls: { typeId: string; name: string; activityEntriesSoFar: number }[] = [];
  failWith: Error | null = null;
  constructor(private readonly entriesSoFar: () => number) {}
  relabelType(typeId: string, name: string): Promise<number> {
    this.calls.push({ typeId, name, activityEntriesSoFar: this.entriesSoFar() });
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(2);
  }
}

function setup() {
  const fixture = createFixture();
  const dependents = new FakeDependents(() => fixture.activity.entries.length);
  const useCase = new UpdateDocumentType(
    fixture.authorization,
    fixture.uow,
    fixture.types,
    fixture.catalog,
    fixture.activity,
    dependents,
  );
  return { ...fixture, dependents, useCase };
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

  describe('search entries of the dependants (DT-166, X18)', () => {
    it('runs in a Serializable unit of work, so the unit of work retries it', async () => {
      const { uow, useCase } = setup();
      await useCase.execute(actor('OWNER'), { ...full, name: 'Adenda nueva' });
      expect(uow.lastOptions?.isolation).toBe('Serializable');
    });

    it('relabels the dependants with the new name before the activity entry', async () => {
      const { dependents, activity, useCase } = setup();
      const before = activity.entries.length;
      await useCase.execute(actor('OWNER'), { ...full, name: 'Adenda nueva' });
      expect(dependents.calls).toEqual([
        { typeId: 'dtyp_adenda', name: 'Adenda nueva', activityEntriesSoFar: before },
      ]);
      expect(activity.entries).toHaveLength(before + 1);
    });

    it('relabels nothing when the name stays, whatever else changes', async () => {
      const { dependents, activity, useCase } = setup();
      const before = activity.entries.length;
      await useCase.execute(actor('OWNER'), { ...full, name: 'Adenda', nameEn: 'Other' });
      expect(activity.entries).toHaveLength(before + 1);
      expect(dependents.calls).toHaveLength(0);
    });

    it('relabels nothing when the edit is refused', async () => {
      const { dependents, useCase } = setup();
      await useCase.execute(actor('MEMBER'), { ...full, name: 'X' }).catch(() => undefined);
      await useCase.execute(actor('OWNER'), { ...full, id: 'dtyp_nope' }).catch(() => undefined);
      expect(dependents.calls).toHaveLength(0);
    });

    it('writes neither the type nor the activity entry when the relabel fails', async () => {
      const { dependents, types, activity, useCase } = setup();
      const before = activity.entries.length;
      dependents.failWith = new Error('relabel failed');
      await expect(
        useCase.execute(actor('OWNER'), { ...full, name: 'Adenda nueva' }),
      ).rejects.toThrow('relabel failed');
      expect(types.rows.find((row) => row.id === 'dtyp_adenda')?.name).toBe('Adenda');
      expect(activity.entries).toHaveLength(before);
    });
  });
});
