import { describe, expect, it } from 'vitest';
import type { Currency } from '../../domain/currency';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryCurrencyRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-currency.repository';
import { actorOf } from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import { ListCurrencies } from './list-currencies.use-case';

const row = (code: string, active = true): Currency => ({
  code,
  name: `${code} name`,
  symbol: code,
  decimals: 2,
  active,
});

const SEED = [row('VES'), row('USD'), row('EUR'), row('COP', false)];

function setup() {
  const uow = new InMemoryUnitOfWork();
  const currencies = new InMemoryCurrencyRepository(uow, SEED);
  return { currencies, useCase: new ListCurrencies(currencies) };
}

describe('ListCurrencies', () => {
  it('lists the active currencies by default, USD first', async () => {
    const { useCase } = setup();
    const codes = (await useCase.execute(actorOf('MEMBER'), { includeInactive: false })).map(
      (c) => c.code,
    );
    expect(codes).toEqual(['USD', 'EUR', 'VES']);
  });

  it('lists every currency with includeInactive (Settings)', async () => {
    const { useCase } = setup();
    const codes = (await useCase.execute(actorOf('OWNER'), { includeInactive: true })).map(
      (c) => c.code,
    );
    expect(codes).toEqual(['USD', 'COP', 'EUR', 'VES']);
  });

  it('returns copies, so a caller cannot change the stored row', async () => {
    const { currencies, useCase } = setup();
    const [first] = await useCase.execute(actorOf('MEMBER'), { includeInactive: false });
    (first as { name: string }).name = 'changed';
    expect(currencies.rows.get('USD')?.name).toBe('USD name');
  });
});
