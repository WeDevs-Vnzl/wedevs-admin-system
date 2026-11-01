import { beforeEach, describe, expect, it } from 'vitest';
import type { EntityType } from '../../../src/shared/domain/enums';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../src/shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

export interface SetTextsHarness {
  readonly uow: UnitOfWorkPort;
  readonly index: SearchIndexPort;
  read(entityType: EntityType, entityId: string): Promise<SearchIndexEntry | null>;
  /** `updatedAt` of the stored entry; `null` when the harness cannot observe it. */
  updatedAt(entityType: EntityType, entityId: string): Promise<Date | null>;
}

const entry = (entityId: string): SearchIndexEntry => ({
  entityType: 'PROJECT',
  entityId,
  code: `PRY-${entityId}`,
  title: `Project ${entityId}`,
  subtitle: 'Old client',
  body: 'old body',
  status: 'ACTIVE',
  archived: false,
});

/** Contract of `SearchIndexPort.setTexts`: set-based relabel, idempotent, transactional. */
export function searchIndexSetTextsContract(
  name: string,
  factory: () => Promise<SetTextsHarness> | SetTextsHarness,
): void {
  describe(`SearchIndexPort.setTexts contract: ${name}`, () => {
    let h: SetTextsHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('throws outside a unit of work', async () => {
      await expect(
        h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'x' }]),
      ).rejects.toThrow();
    });

    it('rewrites subtitle and body, leaves the rest, and ignores a missing entry', async () => {
      await h.uow.run(async () => {
        await h.index.upsert(entry('a'));
        await h.index.upsert(entry('b'));
      });
      await h.uow.run(() =>
        h.index.setTexts('PROJECT', [
          { entityId: 'a', subtitle: 'New client', body: 'new body' },
          { entityId: 'missing', subtitle: 'ghost' },
        ]),
      );
      expect(await h.read('PROJECT', 'a')).toEqual({
        ...entry('a'),
        subtitle: 'New client',
        body: 'new body',
      });
      expect(await h.read('PROJECT', 'b')).toEqual(entry('b'));
      expect(await h.read('PROJECT', 'missing')).toBeNull();
    });

    it('leaves an omitted field alone and sets an explicit null', async () => {
      await h.uow.run(() => h.index.upsert(entry('a')));
      await h.uow.run(() => h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'Only sub' }]));
      expect(await h.read('PROJECT', 'a')).toMatchObject({
        subtitle: 'Only sub',
        body: 'old body',
      });
      await h.uow.run(() => h.index.setTexts('PROJECT', [{ entityId: 'a', body: null }]));
      expect(await h.read('PROJECT', 'a')).toMatchObject({ subtitle: 'Only sub', body: null });
    });

    it('only touches the given entity type', async () => {
      await h.uow.run(async () => {
        await h.index.upsert(entry('a'));
        await h.index.upsert({ ...entry('a'), entityType: 'CLIENT' });
      });
      await h.uow.run(() => h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'New' }]));
      expect((await h.read('CLIENT', 'a'))?.subtitle).toBe('Old client');
      expect((await h.read('PROJECT', 'a'))?.subtitle).toBe('New');
    });

    it('is idempotent and does not bump updatedAt when nothing changes', async () => {
      await h.uow.run(() => h.index.upsert(entry('a')));
      await h.uow.run(() => h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'New' }]));
      const first = await h.updatedAt('PROJECT', 'a');
      await h.uow.run(() => h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'New' }]));
      expect(await h.updatedAt('PROJECT', 'a')).toEqual(first);
      expect((await h.read('PROJECT', 'a'))?.subtitle).toBe('New');
    });

    it('discards the rewrite when the unit of work rolls back', async () => {
      await h.uow.run(() => h.index.upsert(entry('a')));
      await expect(
        h.uow.run(async () => {
          await h.index.setTexts('PROJECT', [{ entityId: 'a', subtitle: 'New' }]);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect((await h.read('PROJECT', 'a'))?.subtitle).toBe('Old client');
    });

    it('handles an empty batch', async () => {
      await h.uow.run(() => h.index.setTexts('PROJECT', []));
    });
  });
}
