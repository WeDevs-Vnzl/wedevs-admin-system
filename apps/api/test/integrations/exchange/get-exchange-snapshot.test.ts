import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { InMemoryExchange } from '../../support/fakes/in-memory-exchange';
import { admin, buildWorld, member, owner, viewer } from './world';

const balances = [{ asset: 'USDT', free: '120.50', locked: '0.00' }];

describe('GetExchangeSnapshot', () => {
  it('answers the last snapshot beside the system balance of the mapped wallet account', async () => {
    const world = buildWorld({ exchange: new InMemoryExchange(balances) });
    await world.sync.execute(SYSTEM_ACTOR);

    const out = await world.get.execute(owner, 'acc_wallet');

    expect(out).toEqual({
      accountId: 'acc_wallet',
      snapshot: { syncedAt: '2026-11-02T12:00:00.000Z', balances },
      systemBalance: { currency: 'USDT', balance: '120.00', balanceUsd: '120.00' },
    });
    expect(world.wallet.asked).toEqual([{ userId: owner.userId, accountId: 'acc_wallet' }]);
  });

  it('answers a null snapshot before the first run, still with the system balance', async () => {
    const world = buildWorld();
    const out = await world.get.execute(admin, 'acc_wallet');
    expect(out?.snapshot).toBeNull();
    expect(out?.systemBalance.balance).toBe('120.00');
  });

  it('answers null when Binance is not mapped or the account is not the mapped one', async () => {
    const off = buildWorld({ mapping: { stripe: null, binance: null } });
    expect(await off.get.execute(owner, 'acc_wallet')).toBeNull();
    const other = buildWorld();
    expect(await other.get.execute(owner, 'acc_other')).toBeNull();
    expect(other.wallet.asked).toEqual([]);
  });

  it('answers null when the mapped account no longer resolves', async () => {
    const world = buildWorld({ balance: null });
    expect(await world.get.execute(owner, 'acc_wallet')).toBeNull();
  });

  it('refuses Member and Viewer before reading anything', async () => {
    const world = buildWorld();
    for (const user of [member, viewer]) {
      await expect(world.get.execute(user, 'acc_wallet')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(world.wallet.asked).toEqual([]);
  });
});
