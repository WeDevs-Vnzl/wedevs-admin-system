import type { CurrentUser } from '../../../shared/application/current-user';
import { DEFAULT_LIST_QUERY } from '../../../shared/domain/list-query';
import type { ListAccounts } from '../../finance/application/use-cases/accounts/list-accounts.use-case';
import type { IntegrationMappingReferences } from './integration-mapping';
import type { PaymentMethodCatalogQuery } from './payment-method-catalog.query';

/**
 * `IntegrationMappingReferences` over finance's exported `ListAccounts` (it runs the caller's `account`
 * `read` grant) and this context's payment-method catalog (DT-110). `ListAccounts` hides inactive accounts, so
 * an account it does not return is "not active"; the lookup pages until it finds the id.
 */
export class CatalogIntegrationMappingReferences implements IntegrationMappingReferences {
  constructor(
    private readonly accounts: ListAccounts,
    private readonly methods: PaymentMethodCatalogQuery,
  ) {}

  async account(
    actor: CurrentUser,
    id: string,
  ): Promise<{ readonly active: boolean; readonly type: string } | null> {
    for (let page = 1; ; page += 1) {
      const result = await this.accounts.execute(actor, { ...DEFAULT_LIST_QUERY, page });
      const found = result.items.find((account) => account.id === id);
      if (found) return { active: found.active, type: found.type };
      if (page >= result.pageCount) return null;
    }
  }

  async methodIsActive(id: string): Promise<boolean> {
    return (await this.methods.activeMethod(id)) !== null;
  }
}
