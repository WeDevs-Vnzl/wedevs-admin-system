import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ExchangeBalance } from '../../ports/exchange.port';

/** DT-110 tokens; bound to their adapters only in `exchange.module.ts`. */
export const EXCHANGE_SNAPSHOT_STORE = Symbol('EXCHANGE_SNAPSHOT_STORE');
export const WALLET_ACCOUNT_BALANCE = Symbol('WALLET_ACCOUNT_BALANCE');

/** The last Binance poll (DT-184): when it ran and the non-zero wallet balances, as the exchange's strings. */
export interface StoredExchangeSnapshot {
  readonly syncedAt: Date;
  readonly balances: readonly ExchangeBalance[];
}

/** Where the last snapshot lives: `Setting` key `integrations.binance.snapshot`. */
export interface ExchangeSnapshotStore {
  /** `null` before the first run or when the stored value is not a snapshot. */
  load(): Promise<StoredExchangeSnapshot | null>;
  save(snapshot: StoredExchangeSnapshot): Promise<void>;
}

/** The system (ledger) balance of the account, valued in USD at today's rate when the currency has one. */
export interface WalletAccountBalance {
  readonly currency: string;
  readonly balance: string;
  readonly balanceUsd: string | null;
}

/** Read of the mapped wallet account through finance's exported application API (DT-110). */
export interface WalletAccountBalancePort {
  /** `null` when the account does not resolve. Runs under the caller's own `can()`. */
  balanceOf(actor: CurrentUser, accountId: string): Promise<WalletAccountBalance | null>;
}
