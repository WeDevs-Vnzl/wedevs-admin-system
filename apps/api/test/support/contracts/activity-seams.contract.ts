import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../src/shared/application/ports/activity-log.port';
import type { RequestMetadata } from '../../../src/shared/application/ports/request-context.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

export interface ActivitySeamsHarness {
  readonly uow: UnitOfWorkPort;
  readonly activityLog: ActivityLogPort;
  /** Sets the metadata `RequestContextPort.current()` returns to the activity writer. */
  setRequest(meta: RequestMetadata | null): void;
  createClient(clientId: string): Promise<void>;
  lastActivityAt(clientId: string): Promise<Date | null>;
  /** Committed entries, in insertion order. */
  readActivity(): Promise<readonly ActivityEntry[]>;
}

const user = { actorType: 'USER', userId: null } as const;
const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  actor: user,
  action: 'UPDATE',
  entityType: 'CLIENT',
  entityId: 'c1',
  entityLabel: 'Client c1',
  ...over,
});

/** Contract of the activity writer's request-metadata and client-metrics behavior (Q-BE2-2, Q-BE2-5). */
export function activitySeamsContract(
  name: string,
  factory: () => Promise<ActivitySeamsHarness> | ActivitySeamsHarness,
): void {
  describe(`ActivityLogPort seams contract: ${name}`, () => {
    let h: ActivitySeamsHarness;
    beforeEach(async () => {
      h = await factory();
    });
    const meta = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' };

    it('fills ip and user agent of a USER entry from the request context', async () => {
      h.setRequest(meta);
      await h.uow.run(() => h.activityLog.record(entry()));
      expect((await h.readActivity())[0]).toMatchObject(meta);
    });

    it('keeps an ip and user agent the entry already carries', async () => {
      h.setRequest(meta);
      await h.uow.run(() => h.activityLog.record(entry({ ip: '198.51.100.1', userAgent: 'x' })));
      expect((await h.readActivity())[0]).toMatchObject({ ip: '198.51.100.1', userAgent: 'x' });
    });

    it('never fills them for SYSTEM and PUBLIC entries', async () => {
      h.setRequest(meta);
      await h.uow.run(async () => {
        await h.activityLog.record(entry({ actor: { actorType: 'SYSTEM', userId: null } }));
        await h.activityLog.record(entry({ actor: { actorType: 'PUBLIC', userId: null } }));
      });
      for (const e of await h.readActivity())
        expect([e.ip ?? null, e.userAgent ?? null]).toEqual([null, null]);
    });

    it('leaves them null outside a request', async () => {
      h.setRequest(null);
      await h.uow.run(() => h.activityLog.record(entry()));
      const [e] = await h.readActivity();
      expect([e?.ip ?? null, e?.userAgent ?? null]).toEqual([null, null]);
    });

    it('bumps lastActivityAt of the entry client in the same transaction', async () => {
      await h.createClient('c1');
      await h.uow.run(() => h.activityLog.record(entry({ clientId: 'c1' })));
      expect(await h.lastActivityAt('c1')).toBeInstanceOf(Date);
    });

    it('bumps every client of touchClientIds and the entry client', async () => {
      await h.createClient('c1');
      await h.createClient('c2');
      await h.uow.run(() =>
        h.activityLog.record(
          entry({ entityType: 'PROJECT', clientId: 'c1', touchClientIds: ['c1', 'c2'] }),
        ),
      );
      expect(await h.lastActivityAt('c1')).toBeInstanceOf(Date);
      expect(await h.lastActivityAt('c2')).toBeInstanceOf(Date);
    });

    it('does not touch metrics for an entry without a client', async () => {
      await h.createClient('c1');
      await h.uow.run(() => h.activityLog.record(entry()));
      expect(await h.lastActivityAt('c1')).toBeNull();
    });

    it('rolls the metrics bump back with the transaction', async () => {
      await h.createClient('c1');
      await expect(
        h.uow.run(async () => {
          await h.activityLog.record(entry({ clientId: 'c1' }));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await h.lastActivityAt('c1')).toBeNull();
      expect(await h.readActivity()).toHaveLength(0);
    });
  });
}
