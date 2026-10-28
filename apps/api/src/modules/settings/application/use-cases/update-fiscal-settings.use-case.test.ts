import { describe, expect, it } from 'vitest';
import { ForbiddenError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemorySettingRepository } from '../../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryCurrencyRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-currency.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import { DEFAULT_FISCAL_SETTINGS } from '../../domain/fiscal-settings';
import { UpdateFiscalSettings } from './update-fiscal-settings.use-case';

const CURRENCIES = [
  { code: 'USD', name: 'Dólar', symbol: '$', decimals: 2, active: true },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, active: true },
];

function setup() {
  const uow = new InMemoryUnitOfWork();
  const settings = new InMemorySettingRepository(uow);
  const currencies = new InMemoryCurrencyRepository(uow, CURRENCIES);
  const activity = new InMemoryActivityLog(uow);
  const useCase = new UpdateFiscalSettings(settingsPolicy, uow, settings, currencies, activity);
  return { settings, activity, useCase };
}

describe('UpdateFiscalSettings', () => {
  it('replaces the parameters, incl. the allowed VAT rates (DT-44), and logs one SETTINGS_CHANGE', async () => {
    const { settings, activity, useCase } = setup();
    const saved = await useCase.execute(actorOf('OWNER'), {
      ivaRates: ['16', '8', '0', '12'],
      ivaDefaultRate: '12',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR'],
      invoiceDefaultDueDays: 30,
    });
    expect(saved).toEqual({
      ivaRates: ['16', '8', '0', '12'],
      ivaDefaultRate: '12',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR'],
      invoiceDefaultDueDays: 30,
    });
    expect(settings.rows.get('fiscal')).toEqual(saved);
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'fiscal',
      changes: {
        ivaRates: [JSON.stringify(['16', '8', '0']), JSON.stringify(['16', '8', '0', '12'])],
        ivaDefaultRate: ['16', '12'],
        igtfCurrencies: ['[]', JSON.stringify(['USD', 'EUR'])],
        invoiceDefaultDueDays: ['15', '30'],
      },
    });
  });

  it('refuses an IGTF currency that is not in the catalog, and writes nothing', async () => {
    const { settings, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), {
        ...DEFAULT_FISCAL_SETTINGS,
        igtfCurrencies: ['USD', 'ABC'],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { igtfCurrencies: ['catalogs.rates.errors.unknownCurrency'] },
    });
    expect(settings.rows.has('fiscal')).toBe(false);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a default VAT rate outside the allowed set with a validation error', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('ADMIN'), { ivaRates: ['16', '0'], ivaDefaultRate: '8' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('writes nothing and logs nothing when the parameters are unchanged', async () => {
    const { settings, activity, useCase } = setup();
    await useCase.execute(actorOf('OWNER'), { ...DEFAULT_FISCAL_SETTINGS });
    expect(activity.entries).toHaveLength(0);
    expect(settings.rows.has('fiscal')).toBe(false);
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('MEMBER'), { ...DEFAULT_FISCAL_SETTINGS }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
