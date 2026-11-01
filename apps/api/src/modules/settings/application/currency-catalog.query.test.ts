import { describe, expect, it } from 'vitest';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryCurrencyRepository } from '../../../../test/settings/catalogs/fakes/in-memory-currency.repository';
import type { Currency } from '../domain/currency';
import { CurrencyCatalogQuery } from './currency-catalog.query';

const currency = (code: string, active: boolean): Currency =>
  ({ code, name: code, symbol: code, decimals: 2, active }) as Currency;

describe('CurrencyCatalogQuery (read for BE-3)', () => {
  const query = new CurrencyCatalogQuery(
    new InMemoryCurrencyRepository(new InMemoryUnitOfWork(), [
      currency('VES', true),
      currency('EUR', false),
    ]),
  );

  it('returns the requested codes that exist, active or not', async () => {
    const known = await query.knownCodes(['VES', 'EUR', 'ZZZ']);
    expect([...known].sort()).toEqual(['EUR', 'VES']);
  });

  it('returns nothing for no codes', async () => {
    expect((await query.knownCodes([])).size).toBe(0);
  });
});
