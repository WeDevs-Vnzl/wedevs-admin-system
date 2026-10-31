import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { AccountRepository } from '../../ports/account.repository.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import { AccountValuation, type AccountOutput } from './account-support';

/** One account with its cached balance and its value in USD at today's rate (PRD §8.7). */
export class GetAccount {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: AccountRepository,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<AccountOutput> {
    assertCan(this.authorization, actor, 'read', 'account');
    const account = await this.accounts.find(id);
    if (!account) throw new NotFoundError();
    return new AccountValuation(this.rates).output(account, todayInCaracas(this.clock.now()));
  }
}
