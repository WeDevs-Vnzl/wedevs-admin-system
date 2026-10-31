import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { MoneyString } from '../../../../../shared/domain/money';
import { accountBalance } from '../../../domain/accounts';
import type { AccountRepository } from '../../ports/account.repository.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import type { FinanceSourcesPort } from '../../ports/finance-sources.port';
import { AccountValuation, dateErrors, ACCOUNT_MESSAGES } from './account-support';

export interface AccountBalanceOutput {
  readonly accountId: string;
  readonly currency: string;
  readonly at: DateOnly;
  readonly balance: MoneyString;
  /** At the rate of `at`; `null` while the currency has none. */
  readonly balanceUsd: MoneyString | null;
}

/**
 * `getAccountBalance(at)` (Q-BE3-3): the balance at the end of a date (today when omitted), calculated by
 * `accountBalance` over the live entries of the account (§9.7). Not the cache: the cache is "now".
 */
export class GetAccountBalance {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: AccountRepository,
    private readonly sources: FinanceSourcesPort,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    accountId: string,
    input: { readonly at?: DateOnly },
  ): Promise<AccountBalanceOutput> {
    assertCan(this.authorization, actor, 'read', 'account');
    if (input.at !== undefined && dateErrors(input.at).length > 0) {
      throw new ValidationFailedError({ fieldErrors: { at: [ACCOUNT_MESSAGES.invalidDate] } });
    }
    const at = input.at ?? todayInCaracas(this.clock.now());
    const account = await this.accounts.find(accountId);
    const source = account ? await this.sources.accountSource(accountId) : null;
    if (!account || !source) throw new NotFoundError();
    const balance = accountBalance(source.activity, at);
    return {
      accountId,
      currency: account.currency,
      at,
      balance,
      balanceUsd: await new AccountValuation(this.rates).usd(balance, account.currency, at),
    };
  }
}
