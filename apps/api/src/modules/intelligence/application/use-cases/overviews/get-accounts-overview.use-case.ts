import type { AccountOutput } from '../../../../finance/application/use-cases/accounts/account-support';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import { sumMoney, type MoneyString } from '../../../../../shared/domain/money';
import { allRows, type ListSource } from './overview-support';

export interface AccountsOverview {
  accounts: AccountOutput[];
  totalBalanceUsd: MoneyString;
}

/**
 * `GET /accounts/overview` (DT-25, PRD §8.7, DT-175). `can(read, account)` first. A card per account (the
 * owner's row, valued at today's rate) and the USD total of the active ones; an account with no rate for
 * its currency adds nothing.
 */
export class GetAccountsOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: ListSource<AccountOutput>,
  ) {}

  async execute(actor: CurrentUser): Promise<AccountsOverview> {
    assertCan(this.authorization, actor, 'read', 'account');
    const accounts = await allRows(
      this.accounts,
      actor,
      { field: 'name', direction: 'asc' },
      { includeInactive: 'true' },
    );
    const usd = accounts.flatMap((account) =>
      account.active && account.balanceUsd !== null ? [account.balanceUsd] : [],
    );
    return { accounts, totalBalanceUsd: sumMoney(usd) };
  }
}
