import { describe, expect, it } from 'vitest';
import { InMemorySettingRepository } from '../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { DEFAULT_FISCAL_SETTINGS } from '../domain/fiscal-settings';
import { FiscalSettingsQuery } from './fiscal-settings.query';

describe('FiscalSettingsQuery (read for BE-3)', () => {
  it('reads the defaults when no fiscal row exists', async () => {
    const query = new FiscalSettingsQuery(new InMemorySettingRepository(new InMemoryUnitOfWork()));
    expect(await query.read()).toEqual(DEFAULT_FISCAL_SETTINGS);
  });

  it('reads the stored parameters and ignores the old igtfMethodCodes key of the seed', async () => {
    const uow = new InMemoryUnitOfWork();
    const settings = new InMemorySettingRepository(uow);
    settings.seed('fiscal', {
      ivaRates: ['16', '8', '0', '12'],
      ivaDefaultRate: '12',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR'],
      igtfMethodCodes: ['ZELLE'],
      invoiceDefaultDueDays: 30,
    });
    expect(await new FiscalSettingsQuery(settings).read()).toEqual({
      ivaRates: ['16', '8', '0', '12'],
      ivaDefaultRate: '12',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR'],
      invoiceDefaultDueDays: 30,
    });
  });

  it('never writes', async () => {
    const uow = new InMemoryUnitOfWork();
    const settings = new InMemorySettingRepository(uow);
    await new FiscalSettingsQuery(settings).read();
    expect(settings.saveCount).toBe(0);
  });
});
