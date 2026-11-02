import type { LedgerRecord } from '../../domain/statement-matching';

export const ACCOUNT_LEDGER_FOR_MATCH = Symbol('ACCOUNT_LEDGER_FOR_MATCH');

/** An account's payments, expenses, transfers and movements in a date window. Adapter over finance's `GetAccountLedger` (3.3). */
export interface AccountLedgerForMatchPort {
  /** `from` and `to` are inclusive date-only values (`YYYY-MM-DD`). */
  entries(accountId: string, from: string, to: string): Promise<LedgerRecord[]>;
}
