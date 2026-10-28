import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryCurrencyRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-currency.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { Currency } from '../../domain/currency';
import { UpdateCurrency } from './update-currency.use-case';

const COP: Currency = {
  code: 'COP',
  name: 'Peso colombiano',
  symbol: 'COL$',
  decimals: 2,
  active: true,
};
const USD: Currency = {
  code: 'USD',
  name: 'Dólar estadounidense',
  symbol: '$',
  decimals: 2,
  active: true,
};

function setup() {
  const uow = new InMemoryUnitOfWork();
  const currencies = new InMemoryCurrencyRepository(uow, [COP, USD]);
  const activity = new InMemoryActivityLog(uow);
  return {
    currencies,
    activity,
    useCase: new UpdateCurrency(settingsPolicy, uow, currencies, activity),
  };
}

describe('UpdateCurrency', () => {
  it('edits every field but the code, and logs the changed fields', async () => {
    const { currencies, activity, useCase } = setup();
    const updated = await useCase.execute(actorOf('ADMIN'), 'COP', {
      name: 'Peso colombiano',
      symbol: '$',
      decimals: 0,
      active: false,
    });
    expect(updated).toEqual({
      code: 'COP',
      name: 'Peso colombiano',
      symbol: '$',
      decimals: 0,
      active: false,
    });
    expect(currencies.rows.get('COP')).toEqual(updated);
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]?.changes).toEqual({
      symbol: ['COL$', '$'],
      decimals: ['2', '0'],
      active: [true, false],
    });
  });

  it('writes nothing and logs nothing when the values are unchanged', async () => {
    const { activity, useCase } = setup();
    const result = await useCase.execute(actorOf('OWNER'), 'COP', {
      name: COP.name,
      symbol: COP.symbol,
      decimals: 2,
      active: true,
    });
    expect(result).toEqual(COP);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown code', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'XYZ', { name: 'x', symbol: 'x', active: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to deactivate USD with a field error on active, and keeps it active', async () => {
    const { currencies, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'USD', { name: 'Dólar', symbol: '$', active: false }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { active: ['catalogs.currencies.errors.usdAlwaysActive'] },
    });
    expect(currencies.rows.get('USD')?.active).toBe(true);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a Member and a field error stays a validation error', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('MEMBER'), 'COP', { name: 'x', symbol: 'x', active: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      useCase.execute(actorOf('OWNER'), 'COP', { name: 'x', symbol: 'x', decimals: 9 }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });
});
