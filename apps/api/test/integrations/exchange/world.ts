import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type {
  IntegrationMapping,
  IntegrationMappingPort,
} from '../../../src/modules/integrations/application/ports/integration-mapping.port';
import type {
  ExchangeSnapshotStore,
  StoredExchangeSnapshot,
  WalletAccountBalance,
  WalletAccountBalancePort,
} from '../../../src/modules/integrations/application/use-cases/exchange/exchange-snapshot.ports';
import { GetExchangeSnapshot } from '../../../src/modules/integrations/application/use-cases/exchange/get-exchange-snapshot.use-case';
import { SyncExchangeAccount } from '../../../src/modules/integrations/application/use-cases/exchange/sync-exchange-account.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryExchange } from '../../support/fakes/in-memory-exchange';
import { InMemoryIntegrationEventStore } from '../../support/fakes/in-memory-integration-event-store';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';

export const userOf = (role: CurrentUser['role']): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});
export const owner = userOf('OWNER');
export const admin = userOf('ADMIN');
export const member = userOf('MEMBER');
export const viewer = userOf('VIEWER');

/** Local stub of `IntegrationMappingPort` (its shared fake belongs to another package). */
export class StubMapping implements IntegrationMappingPort {
  constructor(public mapping: IntegrationMapping) {}
  async load(): Promise<IntegrationMapping> {
    return this.mapping;
  }
}

export class InMemorySnapshotStore implements ExchangeSnapshotStore {
  stored: StoredExchangeSnapshot | null = null;
  saves = 0;
  async load(): Promise<StoredExchangeSnapshot | null> {
    return this.stored;
  }
  async save(snapshot: StoredExchangeSnapshot): Promise<void> {
    this.saves += 1;
    this.stored = snapshot;
  }
}

export class StubWalletBalance implements WalletAccountBalancePort {
  readonly asked: { userId: string; accountId: string }[] = [];
  constructor(public balance: WalletAccountBalance | null) {}
  async balanceOf(actor: CurrentUser, accountId: string): Promise<WalletAccountBalance | null> {
    this.asked.push({ userId: actor.userId, accountId });
    return this.balance;
  }
}

export const DEPOSIT = (id: string, insertedAt: string, amount = '25.50') => ({
  id,
  asset: 'USDT',
  amount,
  insertedAt: new Date(insertedAt),
  txId: `tx_${id}`,
});

export function buildWorld(
  options: {
    exchange?: InMemoryExchange;
    mapping?: IntegrationMapping;
    balance?: WalletAccountBalance | null;
  } = {},
) {
  const uow = new InMemoryUnitOfWork();
  const clock = new FixedClock('2026-11-02T12:00:00.000Z');
  const events = new InMemoryIntegrationEventStore();
  const store = new InMemorySnapshotStore();
  const exchange = options.exchange ?? new InMemoryExchange();
  const mapping = new StubMapping(
    options.mapping ?? { stripe: null, binance: { accountId: 'acc_wallet' } },
  );
  const wallet = new StubWalletBalance(
    options.balance === undefined
      ? { currency: 'USDT', balance: '120.00', balanceUsd: '120.00' }
      : options.balance,
  );
  const authorization = new MatrixAuthorization();
  return {
    uow,
    clock,
    events,
    store,
    mapping,
    wallet,
    sync: new SyncExchangeAccount(uow, exchange, events, store, clock),
    get: new GetExchangeSnapshot(authorization, mapping, store, wallet),
  };
}
