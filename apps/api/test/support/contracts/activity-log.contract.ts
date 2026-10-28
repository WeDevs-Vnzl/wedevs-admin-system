import { beforeEach, describe, expect, it } from 'vitest';
import {
  sampleEntry,
  type KernelHarness,
  type KernelHarnessFactory,
} from './unit-of-work.contract';

/** Contract of `ActivityLogPort`: valid only inside a unit of work, discarded on rollback. */
export function activityLogContract(name: string, factory: KernelHarnessFactory): void {
  describe(`ActivityLogPort contract: ${name}`, () => {
    let h: KernelHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('rejects a record outside a unit of work and stores nothing', async () => {
      await expect(h.activityLog.record(sampleEntry('c1'))).rejects.toThrow();
      expect(await h.readActivity()).toHaveLength(0);
    });

    it('stores entries in order with their fields', async () => {
      await h.uow.run(async () => {
        await h.activityLog.record({
          ...sampleEntry('c1'),
          action: 'UPDATE',
          changes: { name: { from: 'a', to: 'b' } },
          metadata: { source: 'test' },
        });
        await h.activityLog.record(sampleEntry('c2'));
      });
      const entries = await h.readActivity();
      expect(entries.map((e) => e.entityId)).toEqual(['c1', 'c2']);
      expect(entries[0]).toMatchObject({
        action: 'UPDATE',
        entityType: 'CLIENT',
        entityLabel: 'Client c1',
        changes: { name: { from: 'a', to: 'b' } },
        metadata: { source: 'test' },
      });
    });

    it('discards entries when the unit of work rolls back', async () => {
      await expect(
        h.uow.run(async () => {
          await h.activityLog.record(sampleEntry('c1'));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await h.readActivity()).toHaveLength(0);
    });
  });
}
