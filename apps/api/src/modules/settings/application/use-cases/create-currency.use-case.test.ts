import { describe, expect, it } from 'vitest';
import { ForbiddenError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryCurrencyRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-currency.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import { CreateCurrency } from './create-currency.use-case';

function setup() {
  const uow = new InMemoryUnitOfWork();
  const currencies = new InMemoryCurrencyRepository(uow, [
    { code: 'VES', name: 'Bolívar', symbol: 'Bs.', decimals: 2, active: true },
  ]);
  const activity = new InMemoryActivityLog(uow);
  return {
    currencies,
    activity,
    useCase: new CreateCurrency(settingsPolicy, uow, currencies, activity),
  };
}

describe('CreateCurrency', () => {
  it('creates the currency and logs one SETTINGS_CHANGE for an Owner', async () => {
    const { currencies, activity, useCase } = setup();
    const created = await useCase.execute(actorOf('OWNER'), {
      code: 'BRL',
      name: 'Real brasileño',
      symbol: 'R$',
    });
    expect(created).toEqual({
      code: 'BRL',
      name: 'Real brasileño',
      symbol: 'R$',
      decimals: 2,
      active: true,
    });
    expect(currencies.rows.get('BRL')).toEqual(created);
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'BRL',
      entityLabel: 'Real brasileño',
      changes: { currency: [null, 'BRL'] },
    });
  });

  it('lets an Admin create a currency', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('ADMIN'), { code: 'BRL', name: 'Real', symbol: 'R$' }),
    ).resolves.toMatchObject({ code: 'BRL' });
  });

  it('refuses a code that already exists with CONFLICT on the code, and writes nothing', async () => {
    const { currencies, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), { code: 'VES', name: 'x', symbol: 'x' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { code: ['catalogs.currencies.errors.codeTaken'] },
    });
    expect(currencies.rows.size).toBe(1);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a Member with FORBIDDEN and writes nothing', async () => {
    const { currencies, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('MEMBER'), { code: 'BRL', name: 'Real', symbol: 'R$' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(currencies.rows.has('BRL')).toBe(false);
    expect(activity.entries).toHaveLength(0);
  });

  it('rejects a malformed code with a validation error on the code', async () => {
    const { useCase } = setup();
    const attempt = useCase.execute(actorOf('OWNER'), { code: 'us', name: 'x', symbol: 'x' });
    await expect(attempt).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(attempt).rejects.toMatchObject({
      fieldErrors: { code: ['validation.currency.invalid'] },
    });
  });
});
