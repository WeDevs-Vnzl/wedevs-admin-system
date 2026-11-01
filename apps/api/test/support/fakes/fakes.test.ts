import { describe, expect, it } from 'vitest';
import { activityLogContract } from '../contracts/activity-log.contract';
import { activitySeamsContract } from '../contracts/activity-seams.contract';
import { clientMetricsWriterContract } from '../contracts/client-metrics-writer.contract';
import { rowLocksContract } from '../contracts/row-locks.contract';
import { searchIndexContract } from '../contracts/search-index.contract';
import { sequenceContract } from '../contracts/sequence.contract';
import { unitOfWorkContract, type KernelHarness } from '../contracts/unit-of-work.contract';
import { FixedClock } from './fixed-clock';
import { FixedRequestContext } from './fixed-request-context';
import { InMemoryActivityLog } from './in-memory-activity-log';
import { InMemoryClientMetricsWriter } from './in-memory-client-metrics-writer';
import { InMemoryRowLocks } from './in-memory-row-locks';
import { InMemorySearchIndex } from './in-memory-search-index';
import { InMemorySequence } from './in-memory-sequence';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { SequentialIdGenerator } from './sequential-id-generator';

function build(): KernelHarness & { raw: InMemorySequence } {
  const uow = new InMemoryUnitOfWork();
  const activityLog = new InMemoryActivityLog(uow);
  const raw = new InMemorySequence(uow);
  return {
    uow,
    activityLog,
    sequence: raw,
    raw,
    readActivity: async () => activityLog.entries,
  };
}

unitOfWorkContract('in-memory fakes', build);
rowLocksContract('in-memory fakes', () => {
  const uow = new InMemoryUnitOfWork();
  return { uow, locks: new InMemoryRowLocks(uow) };
});
activityLogContract('in-memory fakes', build);
sequenceContract('in-memory fakes', build, async (h, name, value) => {
  (h as ReturnType<typeof build>).raw.seed(name, value);
});

searchIndexContract('in-memory fakes', () => {
  const uow = new InMemoryUnitOfWork();
  const index = new InMemorySearchIndex(uow);
  return {
    uow,
    index,
    read: async (type, id) => index.get(type, id) ?? null,
    count: async () => index.size,
  };
});

function buildMetrics() {
  const uow = new InMemoryUnitOfWork();
  const metrics = new InMemoryClientMetricsWriter(uow);
  return { uow, metrics };
}

clientMetricsWriterContract('in-memory fakes', () => {
  const { uow, metrics } = buildMetrics();
  return {
    uow,
    metrics,
    createClient: async (id) => metrics.addClient(id),
    seedReceivable: async (id, value) => metrics.seedReceivable(id, value),
    read: async (id) => metrics.get(id) ?? null,
  };
});

activitySeamsContract('in-memory fakes', () => {
  const { uow, metrics } = buildMetrics();
  const requestContext = new FixedRequestContext();
  const activityLog = new InMemoryActivityLog(uow, { requestContext, metrics });
  return {
    uow,
    activityLog,
    setRequest: (meta) => requestContext.set(meta),
    createClient: async (id) => metrics.addClient(id),
    lastActivityAt: async (id) => metrics.get(id)?.lastActivityAt ?? null,
    readActivity: async () => activityLog.entries,
  };
});

describe('FixedRequestContext', () => {
  it('run overrides the value for the duration of fn, sync or async', async () => {
    const ctx = new FixedRequestContext({ ip: 'base', userAgent: null });
    const meta = { ip: '1.1.1.1', userAgent: 'ua' };
    expect(ctx.run(meta, () => ctx.current())).toEqual(meta);
    expect(await ctx.run(meta, async () => ctx.current())).toEqual(meta);
    expect(ctx.current()?.ip).toBe('base');
    expect(() =>
      ctx.run(meta, () => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(ctx.current()?.ip).toBe('base');
  });
});

describe('FixedClock', () => {
  it('returns a copy of a settable instant', () => {
    const clock = new FixedClock('2026-03-10T04:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-03-10T04:00:00.000Z');
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-03-10T04:00:00.000Z');
    clock.set('2027-01-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:01.000Z');
  });
});

describe('SequentialIdGenerator', () => {
  it('yields id_1, id_2, … and honours a prefix', () => {
    const ids = new SequentialIdGenerator();
    expect([ids.next(), ids.next()]).toEqual(['id_1', 'id_2']);
    expect(new SequentialIdGenerator('cli').next()).toBe('cli_1');
  });
});

describe('InMemoryUnitOfWork', () => {
  it('records the isolation option of the outermost run', async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.run(async () => uow.run(async () => 1, { isolation: 'ReadCommitted' }), {
      isolation: 'Serializable',
    });
    expect(uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(uow.isActive).toBe(false);
  });

  it('rejects a second top-level run that starts while another is open', async () => {
    const uow = new InMemoryUnitOfWork();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = uow.run(() => gate);
    await expect(uow.run(async () => 1)).rejects.toThrow(/concurrent top-level run/);
    release();
    await first;
    await expect(uow.run(async () => 2)).resolves.toBe(2);
  });
});
