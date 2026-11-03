import { Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { DEFAULT_LIST_QUERY } from '../../../../shared/domain/list-query';
import { ListAccounts } from '../../../finance/application/use-cases/accounts/list-accounts.use-case';
import type { MappedAccountCurrencyPort } from '../../application/use-cases/payment-links/stripe-link-target.port';

/**
 * `MappedAccountCurrencyPort` over finance's exported `ListAccounts` (DT-110, rule (e)); no finance repository
 * is imported. `ListAccounts` hides inactive accounts, so an account it does not return answers `null`; the
 * lookup pages until it finds the id.
 */
@Injectable()
export class FinanceMappedAccountCurrency implements MappedAccountCurrencyPort {
  constructor(private readonly accounts: ListAccounts) {}

  async currencyOf(actor: CurrentUser, accountId: string): Promise<string | null> {
    for (let page = 1; ; page += 1) {
      const result = await this.accounts.execute(actor, { ...DEFAULT_LIST_QUERY, page });
      const found = result.items.find((account) => account.id === accountId);
      if (found) return found.currency;
      if (page >= result.pageCount) return null;
    }
  }
}
