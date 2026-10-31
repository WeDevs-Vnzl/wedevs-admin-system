import { beforeEach, describe, expect, it } from 'vitest';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

export interface RowLocksHarness {
  readonly uow: UnitOfWorkPort;
  readonly locks: RowLocksPort;
}

/** Contract of `RowLocksPort`: unit-of-work only, one up-front lock, subset re-locks allowed. */
export function rowLocksContract(
  name: string,
  factory: () => Promise<RowLocksHarness> | RowLocksHarness,
): void {
  describe(`RowLocksPort contract: ${name}`, () => {
    let h: RowLocksHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('rejects a lock outside a unit of work', async () => {
      await expect(h.locks.lock({ Client: ['c1'] })).rejects.toThrow(/unit ?of ?work/i);
    });

    it('accepts any input order, duplicates, ids of rows that do not exist and an empty set', async () => {
      await h.uow.run(() =>
        h.locks.lock({ Account: ['a2', 'a1', 'a1'], Project: ['p1'], Client: ['ghost'] }),
      );
      await h.uow.run(() => h.locks.lock({}));
    });

    it('allows re-locking a subset, in a nested unit of work too', async () => {
      await h.uow.run(async () => {
        await h.locks.lock({ Client: ['c1', 'c2'], Invoice: ['i1'] });
        await h.locks.lock({ Client: ['c2'] });
        await h.uow.run(() => h.locks.lock({ Invoice: ['i1'], Client: ['c1'] }));
        await h.locks.lock({});
      });
    });

    it('throws a plain Error when a second call adds a row of a held class', async () => {
      await h.uow.run(async () => {
        await h.locks.lock({ Client: ['c1'] });
        await expect(h.locks.lock({ Client: ['c1', 'c2'] })).rejects.toThrow(/second lock/i);
      });
    });

    it('throws when a second call adds a class, also after an empty first call', async () => {
      await h.uow.run(async () => {
        await h.locks.lock({ Client: ['c1'] });
        await expect(h.locks.lock({ Project: ['p1'] })).rejects.toThrow(/second lock/i);
      });
      await h.uow.run(async () => {
        await h.locks.lock({});
        await expect(h.locks.lock({ Account: ['a1'] })).rejects.toThrow(/second lock/i);
      });
    });

    it('starts afresh in the next unit of work, and after a rolled-back one', async () => {
      await h.uow.run(() => h.locks.lock({ Client: ['c1'] }));
      await h.uow.run(() => h.locks.lock({ Client: ['c2'] }));
      await expect(
        h.uow.run(async () => {
          await h.locks.lock({ Client: ['c1'] });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await h.uow.run(() => h.locks.lock({ Project: ['p1'] }));
    });
  });
}
