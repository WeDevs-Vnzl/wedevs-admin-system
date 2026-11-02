import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ExchangeBalance } from '../../ports/exchange.port';
import type { IntegrationMappingPort } from '../../ports/integration-mapping.port';
import type {
  ExchangeSnapshotStore,
  WalletAccountBalance,
  WalletAccountBalancePort,
} from './exchange-snapshot.ports';

export interface ExchangeSnapshotOutput {
  readonly accountId: string;
  /** `null` until the first poll ran. */
  readonly snapshot: {
    /** ISO 8601 UTC. */
    readonly syncedAt: string;
    readonly balances: readonly ExchangeBalance[];
  } | null;
  readonly systemBalance: WalletAccountBalance;
}

/**
 * `GetExchangeSnapshot` (DT-184), `account` `read`: the last Binance snapshot beside the system balance of the
 * account the Binance wallet is mapped to. `null` when the account is not that account (the integration is off,
 * unmapped, or the id is another account) or the mapped account no longer resolves.
 */
export class GetExchangeSnapshot {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly mapping: IntegrationMappingPort,
    private readonly store: ExchangeSnapshotStore,
    private readonly wallet: WalletAccountBalancePort,
  ) {}

  async execute(actor: CurrentUser, accountId: string): Promise<ExchangeSnapshotOutput | null> {
    assertCan(this.authorization, actor, 'read', 'account');
    const { binance } = await this.mapping.load();
    if (binance === null || binance.accountId !== accountId) return null;
    const systemBalance = await this.wallet.balanceOf(actor, accountId);
    if (systemBalance === null) return null;
    const stored = await this.store.load();
    return {
      accountId,
      snapshot: stored
        ? { syncedAt: stored.syncedAt.toISOString(), balances: stored.balances }
        : null,
      systemBalance,
    };
  }
}
