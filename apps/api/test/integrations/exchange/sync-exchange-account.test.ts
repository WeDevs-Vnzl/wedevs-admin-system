import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { InMemoryExchange } from '../../support/fakes/in-memory-exchange';
import { DEPOSIT, buildWorld, owner } from './world';

const balances = [
  { asset: 'USDT', free: '120.50', locked: '0.00' },
  { asset: 'BTC', free: '0.00000000', locked: '0.00000000' },
  { asset: 'ETH', free: '0.00000000', locked: '0.10000000' },
];

describe('SyncExchangeAccount', () => {
  it('is for the SYSTEM actor only', async () => {
    const world = buildWorld();
    await expect(
      world.sync.execute({ actorType: 'USER', userId: owner.userId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(world.store.saves).toBe(0);
  });

  it('stores the non-zero balances as the snapshot and records one event per deposit id', async () => {
    const exchange = new InMemoryExchange(balances, [
      DEPOSIT('d1', '2026-11-01T10:00:00Z'),
      DEPOSIT('d2', '2026-11-02T08:00:00Z', '10.00'),
    ]);
    const world = buildWorld({ exchange });

    const out = await world.sync.execute(SYSTEM_ACTOR);

    expect(out).toEqual({ balances: 2, deposits: 2, recorded: 2, duplicates: 0 });
    expect(world.store.stored).toEqual({
      syncedAt: new Date('2026-11-02T12:00:00.000Z'),
      balances: [balances[0], balances[2]],
    });
    expect(world.events.all()).toEqual([
      expect.objectContaining({
        provider: 'BINANCE',
        eventId: 'd1',
        type: 'deposit',
        outcome: 'PROCESSED',
        reasonCode: null,
        entityType: null,
        entityId: null,
      }),
      expect.objectContaining({ provider: 'BINANCE', eventId: 'd2' }),
    ]);
  });

  it('is idempotent: a rerun records no second event for the same deposit', async () => {
    const exchange = new InMemoryExchange(balances, [DEPOSIT('d1', '2026-11-02T10:00:00Z')]);
    const world = buildWorld({ exchange });
    await world.sync.execute(SYSTEM_ACTOR);
    world.clock.advance(60_000);

    const second = await world.sync.execute(SYSTEM_ACTOR);

    expect(second).toMatchObject({ deposits: 1, recorded: 0, duplicates: 1 });
    expect(world.events.all()).toHaveLength(1);
    expect(world.store.stored?.syncedAt).toEqual(new Date('2026-11-02T12:01:00.000Z'));
  });

  it('asks only for deposits since the last run, with an overlap, and 30 days on the first run', async () => {
    const asked: Date[] = [];
    class Spy extends InMemoryExchange {
      override async deposits(since: Date) {
        asked.push(since);
        return super.deposits(since);
      }
    }
    const world = buildWorld({ exchange: new Spy(balances) });
    await world.sync.execute(SYSTEM_ACTOR);
    world.clock.advance(24 * 60 * 60 * 1000);
    await world.sync.execute(SYSTEM_ACTOR);

    expect(asked[0]).toEqual(new Date('2026-10-03T12:00:00.000Z'));
    // Last run at 2026-11-02T12:00Z, three days of overlap for late credits.
    expect(asked[1]).toEqual(new Date('2026-10-30T12:00:00.000Z'));
  });

  it('writes nothing when the exchange fails, so the next run starts from the same point', async () => {
    class Down extends InMemoryExchange {
      override async deposits(): Promise<never> {
        throw new Error('RATE_LIMITED');
      }
    }
    const world = buildWorld({ exchange: new Down(balances) });
    await expect(world.sync.execute(SYSTEM_ACTOR)).rejects.toThrow('RATE_LIMITED');
    expect(world.store.stored).toBeNull();
    expect(world.events.all()).toEqual([]);
  });
});
