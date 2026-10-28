import type { CurrentUser } from '../../../../shared/application/current-user';
import { sortCurrencies, type Currency } from '../../domain/currency';
import type { CurrencyRepository } from '../ports/currency.repository.port';

/** Input of the catalog lists: pickers get the active rows; Settings asks for every row. */
export type ListCatalogInput = { readonly includeInactive: boolean };

/**
 * Lists the currencies (PRD §8.15), USD first. Authorization is the route's `@Authenticated()` declaration:
 * a reference catalog read (DT-71), so there is no `can()` action to check here.
 */
export class ListCurrencies {
  constructor(private readonly currencies: CurrencyRepository) {}

  async execute(_actor: CurrentUser, input: ListCatalogInput): Promise<Currency[]> {
    const rows = await this.currencies.list();
    return sortCurrencies(rows.filter((row) => input.includeInactive || row.active));
  }
}
