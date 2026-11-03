import type { AccountLedgerForMatchPort } from '../../../src/modules/integrations/application/ports/account-ledger-for-match.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { LedgerRecord } from '../../../src/modules/integrations/domain/statement-matching';

/** Fake `AccountLedgerForMatchPort`: records are scripted per account. */
export class InMemoryAccountLedgerForBankMatch implements AccountLedgerForMatchPort {
  /** The actor of each read, in call order. */
  readonly actors: CurrentUser[] = [];
  private readonly byAccount = new Map<string, LedgerRecord[]>();

  seed(accountId: string, records: LedgerRecord[]): void {
    this.byAccount.set(accountId, records);
  }

  async entries(
    actor: CurrentUser,
    accountId: string,
    from: string,
    to: string,
  ): Promise<LedgerRecord[]> {
    this.actors.push(actor);
    return (this.byAccount.get(accountId) ?? []).filter((r) => r.date >= from && r.date <= to);
  }
}
