import { beforeEach, describe, expect, it } from 'vitest';
import type { EntityType } from '../../../src/shared/domain/enums';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../src/shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

export interface SearchIndexHarness {
  readonly uow: UnitOfWorkPort;
  readonly index: SearchIndexPort;
  /** Committed entry of `(entityType, entityId)`, or `null`. */
  read(entityType: EntityType, entityId: string): Promise<SearchIndexEntry | null>;
  count(): Promise<number>;
}

export const sampleSearchEntry = (entityId: string): SearchIndexEntry => ({
  entityType: 'CLIENT',
  entityId,
  code: `CLI-${entityId}`,
  title: `Client ${entityId}`,
  subtitle: 'Acme',
  body: 'plain text body',
  status: 'ACTIVE',
  archived: false,
});

/** Contract of `SearchIndexPort`: transactional, idempotent upsert, archived flag. */
export function searchIndexContract(
  name: string,
  factory: () => Promise<SearchIndexHarness> | SearchIndexHarness,
): void {
  describe(`SearchIndexPort contract: ${name}`, () => {
    let h: SearchIndexHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('rejects writes outside a unit of work', async () => {
      await expect(h.index.upsert(sampleSearchEntry('a'))).rejects.toThrow();
      await expect(h.index.setArchived('CLIENT', 'a', true)).rejects.toThrow();
      expect(await h.count()).toBe(0);
    });

    it('upsert is idempotent and the last write wins', async () => {
      await h.uow.run(async () => {
        await h.index.upsert(sampleSearchEntry('a'));
        await h.index.upsert(sampleSearchEntry('a'));
      });
      await h.uow.run(() => h.index.upsert({ ...sampleSearchEntry('a'), title: 'Renamed' }));
      expect(await h.count()).toBe(1);
      expect(await h.read('CLIENT', 'a')).toMatchObject({ title: 'Renamed', code: 'CLI-a' });
    });

    it('keeps entries of different entity types apart', async () => {
      await h.uow.run(async () => {
        await h.index.upsert(sampleSearchEntry('x'));
        await h.index.upsert({ ...sampleSearchEntry('x'), entityType: 'PROJECT', title: 'P' });
      });
      expect(await h.count()).toBe(2);
      expect((await h.read('PROJECT', 'x'))?.title).toBe('P');
    });

    it('setArchived flips the flag and is a no-op for a missing entry', async () => {
      await h.uow.run(() => h.index.upsert(sampleSearchEntry('a')));
      await h.uow.run(async () => {
        await h.index.setArchived('CLIENT', 'a', true);
        await h.index.setArchived('CLIENT', 'missing', true);
      });
      expect((await h.read('CLIENT', 'a'))?.archived).toBe(true);
      expect(await h.read('CLIENT', 'missing')).toBeNull();
      await h.uow.run(() => h.index.setArchived('CLIENT', 'a', false));
      expect((await h.read('CLIENT', 'a'))?.archived).toBe(false);
    });

    it('discards writes when the unit of work rolls back', async () => {
      await expect(
        h.uow.run(async () => {
          await h.index.upsert(sampleSearchEntry('a'));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await h.count()).toBe(0);
    });
  });
}
