import { describe, expect, it } from 'vitest';
import { PurgeShareAccessLog } from '../../../src/modules/documents/application/use-cases/shares/purge-share-access-log.use-case';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import {
  InMemoryUnitOfWork,
  type TransactionParticipant,
} from '../../support/fakes/in-memory-unit-of-work';
import { InMemoryShareAccessLogRetention } from './fakes/in-memory-share-access-log-retention';

const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;
const USER = { actorType: 'USER', userId: 'usr_owner' } as const;
const PUBLIC = { actorType: 'PUBLIC', userId: null } as const;

// 2026-10-30 12:00 UTC is 08:00 in Caracas: the business day is 2026-10-30, so the cutoff is the start
// of 2024-10-30 in Caracas (UTC-4), 2024-10-30T04:00:00.000Z.
const NOW = '2026-10-30T12:00:00.000Z';
const CUTOFF = new Date('2024-10-30T04:00:00.000Z');

function build(rows: Date[], now = NOW, options?: { batchSize: number; maxBatches: number }) {
  const clock = new FixedClock(now);
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const retention = new InMemoryShareAccessLogRetention(rows);
  const purge = new PurgeShareAccessLog(uow, retention, activity, clock, options);
  return { purge, retention, activity, clock };
}

describe('PurgeShareAccessLog (DT-74, A9)', () => {
  it.each([USER, PUBLIC])('is SYSTEM only: %j is FORBIDDEN and deletes nothing', async (actor) => {
    const { purge, retention } = build([new Date('2020-01-01T00:00:00Z')]);
    await expect(purge.execute(actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(retention.calls).toEqual([]);
    expect(retention.rows).toHaveLength(1);
  });

  it('deletes rows older than 24 months from the Caracas day and keeps the rest', async () => {
    const { purge, retention } = build([
      new Date('2020-01-01T00:00:00Z'),
      new Date('2024-10-30T03:59:59.999Z'),
      new Date('2024-10-30T04:00:00.001Z'),
      new Date('2026-10-30T11:00:00Z'),
    ]);
    const result = await purge.execute(SYSTEM);
    expect(result.deleted).toBe(2);
    expect(retention.calls[0]?.cutoff).toEqual(CUTOFF);
    expect(retention.rows.map((r) => r.toISOString())).toEqual([
      '2024-10-30T04:00:00.001Z',
      '2026-10-30T11:00:00.000Z',
    ]);
  });

  it('keeps the row at exactly the cutoff', async () => {
    const { purge, retention } = build([CUTOFF]);
    expect((await purge.execute(SYSTEM)).deleted).toBe(0);
    expect(retention.rows).toEqual([CUTOFF]);
  });

  it('follows the Caracas day, not the UTC day', async () => {
    // 02:00 UTC of Oct 31 is still Oct 30 in Caracas; 04:00 UTC is Oct 31.
    const late = build([], '2026-10-31T02:00:00.000Z');
    await late.purge.execute(SYSTEM);
    expect(late.retention.calls[0]?.cutoff).toEqual(CUTOFF);
    const next = build([], '2026-10-31T04:00:00.000Z');
    await next.purge.execute(SYSTEM);
    expect(next.retention.calls[0]?.cutoff).toEqual(new Date('2024-10-31T04:00:00.000Z'));
  });

  it('clamps February 29 to the last day of the month two years earlier', async () => {
    const { purge, retention } = build([], '2028-02-29T15:00:00.000Z');
    await purge.execute(SYSTEM);
    expect(retention.calls[0]?.cutoff).toEqual(new Date('2026-02-28T04:00:00.000Z'));
  });

  it('works in batches, stops at the first short batch and counts every batch', async () => {
    const old = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2020, 0, 1, 0, i)));
    const { purge, retention } = build(old, NOW, { batchSize: 10, maxBatches: 10 });
    const result = await purge.execute(SYSTEM);
    expect(result).toMatchObject({ deleted: 25, batches: 3 });
    expect(retention.calls.map((c) => c.limit)).toEqual([10, 10, 10]);
    expect(retention.rows).toEqual([]);
  });

  it('is bounded per run: the rest waits for the next one', async () => {
    const old = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2020, 0, 1, 0, i)));
    const { purge, retention } = build(old, NOW, { batchSize: 10, maxBatches: 2 });
    expect(await purge.execute(SYSTEM)).toMatchObject({ deleted: 20, batches: 2 });
    expect(retention.rows).toHaveLength(5);
    expect(await purge.execute(SYSTEM)).toMatchObject({ deleted: 5, batches: 1 });
  });

  it('writes one SYSTEM_JOB entry per batch that deleted rows, with that batch count; a rerun writes none', async () => {
    const old = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2020, 0, 1, 0, i)));
    const { purge, activity } = build(old, NOW, { batchSize: 10, maxBatches: 10 });
    await purge.execute(SYSTEM);
    expect(activity.entries).toHaveLength(3);
    expect(activity.entries.map((e) => e.metadata)).toEqual([
      { deleted: 10, batches: 1, cutoff: CUTOFF.toISOString() },
      { deleted: 10, batches: 2, cutoff: CUTOFF.toISOString() },
      { deleted: 5, batches: 3, cutoff: CUTOFF.toISOString() },
    ]);
    expect(activity.entries[0]).toMatchObject({
      action: 'SYSTEM_JOB',
      entityType: 'SETTING',
      entityId: 'purge-share-access-log',
      actor: SYSTEM,
    });
    const rerun = await purge.execute(SYSTEM);
    expect(rerun).toMatchObject({ deleted: 0, batches: 1 });
    expect(activity.entries).toHaveLength(3);
  });

  it('commits the deletes and the entry of a batch together: a failing entry rolls the deletes back', async () => {
    const old = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2020, 0, 1, 0, i)));
    const clock = new FixedClock(NOW);
    const uow = new InMemoryUnitOfWork();
    const activity = new InMemoryActivityLog(uow);
    const retention = new InMemoryShareAccessLogRetention(old);
    uow.enlist({
      snapshot: [] as Date[],
      begin() {
        this.snapshot = [...retention.rows];
      },
      commit() {},
      rollback() {
        retention.rows = this.snapshot;
      },
    } as TransactionParticipant & { snapshot: Date[] });
    const failing = { record: () => Promise.reject(new Error('audit down')) };
    const purge = new PurgeShareAccessLog(uow, retention, failing, clock);
    await expect(purge.execute(SYSTEM)).rejects.toThrow('audit down');
    expect(retention.rows).toHaveLength(5);
    expect(activity.entries).toHaveLength(0);
  });
});
