import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../src/shared/application/ports/activity-log.port';
import type { SequencePort } from '../../../src/shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

/** Everything the shared-kernel contract suites need from one adapter set. */
export interface KernelHarness {
  readonly uow: UnitOfWorkPort;
  readonly activityLog: ActivityLogPort;
  readonly sequence: SequencePort;
  /** Committed activity entries, in insertion order. */
  readActivity(): Promise<readonly ActivityEntry[]>;
}

export type KernelHarnessFactory = () => Promise<KernelHarness> | KernelHarness;

export const sampleEntry = (entityId: string): ActivityEntry => ({
  actor: { actorType: 'SYSTEM', userId: null },
  action: 'CREATE',
  entityType: 'CLIENT',
  entityId,
  entityLabel: `Client ${entityId}`,
});

/** Contract of `UnitOfWorkPort`: commit, rollback, nesting. Run it against every adapter. */
export function unitOfWorkContract(name: string, factory: KernelHarnessFactory): void {
  describe(`UnitOfWorkPort contract: ${name}`, () => {
    let h: KernelHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('returns the value of the work', async () => {
      await expect(h.uow.run(async () => 42)).resolves.toBe(42);
    });

    it('commits what the work wrote', async () => {
      await h.uow.run(async () => {
        await h.activityLog.record(sampleEntry('c1'));
      });
      expect((await h.readActivity()).map((e) => e.entityId)).toEqual(['c1']);
    });

    it('rethrows the error and rolls back everything the work wrote', async () => {
      const boom = new Error('boom');
      await expect(
        h.uow.run(async () => {
          await h.activityLog.record(sampleEntry('c1'));
          await h.sequence.next('CLI');
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await h.readActivity()).toHaveLength(0);
    });

    it('a nested run joins the outer transaction and commits with it', async () => {
      await h.uow.run(async () => {
        await h.uow.run(async () => {
          await h.activityLog.record(sampleEntry('inner'));
        });
        await h.activityLog.record(sampleEntry('outer'));
      });
      expect((await h.readActivity()).map((e) => e.entityId)).toEqual(['inner', 'outer']);
    });

    it('a failure after a completed nested run rolls the nested writes back too', async () => {
      await expect(
        h.uow.run(async () => {
          await h.uow.run(async () => {
            await h.activityLog.record(sampleEntry('inner'));
          });
          throw new Error('outer fails');
        }),
      ).rejects.toThrow('outer fails');
      expect(await h.readActivity()).toHaveLength(0);
    });

    it('a nested run requesting a stricter isolation throws and rolls the outer work back', async () => {
      await expect(
        h.uow.run(
          async () => {
            await h.activityLog.record(sampleEntry('outer'));
            await h.uow.run(async () => undefined, { isolation: 'Serializable' });
          },
          { isolation: 'ReadCommitted' },
        ),
      ).rejects.toThrow(/Serializable.*ReadCommitted|ReadCommitted.*Serializable/);
      expect(await h.readActivity()).toHaveLength(0);
    });

    it('a nested run with an omitted level counts as ReadCommitted and rejects RepeatableRead nesting', async () => {
      await expect(
        h.uow.run(async () => h.uow.run(async () => 1, { isolation: 'RepeatableRead' })),
      ).rejects.toThrow(/RepeatableRead/);
      expect(await h.readActivity()).toHaveLength(0);
    });

    it('a nested run with an equal, weaker or omitted level joins the outer transaction', async () => {
      await h.uow.run(
        async () => {
          await h.uow.run(async () => h.activityLog.record(sampleEntry('equal')), {
            isolation: 'Serializable',
          });
          await h.uow.run(async () => h.activityLog.record(sampleEntry('weaker')), {
            isolation: 'RepeatableRead',
          });
          await h.uow.run(async () => h.activityLog.record(sampleEntry('lowest')), {
            isolation: 'ReadCommitted',
          });
          await h.uow.run(async () => h.activityLog.record(sampleEntry('omitted')));
        },
        { isolation: 'Serializable' },
      );
      expect((await h.readActivity()).map((e) => e.entityId)).toEqual([
        'equal',
        'weaker',
        'lowest',
        'omitted',
      ]);
    });

    it('a caught stricter-nesting error does not break the outer transaction', async () => {
      await h.uow.run(async () => {
        await expect(
          h.uow.run(async () => undefined, { isolation: 'Serializable' }),
        ).rejects.toThrow();
        await h.activityLog.record(sampleEntry('still-ok'));
      });
      expect((await h.readActivity()).map((e) => e.entityId)).toEqual(['still-ok']);
    });

    it('accepts an isolation option', async () => {
      await expect(h.uow.run(async () => 'ok', { isolation: 'Serializable' })).resolves.toBe('ok');
    });

    it('is reusable after a rollback', async () => {
      await expect(
        h.uow.run(async () => {
          throw new Error('x');
        }),
      ).rejects.toThrow('x');
      await h.uow.run(async () => {
        await h.activityLog.record(sampleEntry('after'));
      });
      expect((await h.readActivity()).map((e) => e.entityId)).toEqual(['after']);
    });
  });
}
