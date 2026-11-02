import type { AccountLedgerForMatchPort } from '../../../src/modules/integrations/application/ports/account-ledger-for-match.port';
import type { LedgerRecord } from '../../../src/modules/integrations/domain/statement-matching';

/** Fake `AccountLedgerForMatchPort`: records are scripted per account. */
export class InMemoryAccountLedgerForBankMatch implements AccountLedgerForMatchPort {
  private readonly byAccount = new Map<string, LedgerRecord[]>();

  seed(accountId: string, records: LedgerRecord[]): void {
    this.byAccount.set(accountId, records);
  }

  async entries(accountId: string, from: string, to: string): Promise<LedgerRecord[]> {
    return (this.byAccount.get(accountId) ?? []).filter((r) => r.date >= from && r.date <= to);
  }
}
