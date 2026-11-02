/** DT-110 token; bound to the Binance adapter (or a fake) only in the module. */
export const EXCHANGE = Symbol('EXCHANGE');

/** One wallet balance. Amounts stay strings end to end (C15). */
export interface ExchangeBalance {
  readonly asset: string;
  readonly free: string;
  readonly locked: string;
}

export interface ExchangeDeposit {
  readonly id: string;
  readonly asset: string;
  readonly amount: string;
  readonly insertedAt: Date;
  readonly txId: string | null;
}

/** Read-only exchange access (DT-184): balances and deposits, never an order or a withdrawal. */
export interface ExchangePort {
  balances(): Promise<ExchangeBalance[]>;
  /** Deposits received at or after `since`, oldest first. */
  deposits(since: Date): Promise<ExchangeDeposit[]>;
}
