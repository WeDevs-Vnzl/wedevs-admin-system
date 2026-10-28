import { describe, expect, it } from 'vitest';
import { InMemorySettingRepository } from '../../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { actorOf } from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import { DEFAULT_FISCAL_SETTINGS } from '../../domain/fiscal-settings';
import { FiscalSettingsQuery } from '../fiscal-settings.query';
import { GetFiscalSettings } from './get-fiscal-settings.use-case';

describe('GetFiscalSettings', () => {
  it('returns the parameters to any signed-in caller (DT-71: reference catalog read)', async () => {
    const settings = new InMemorySettingRepository(new InMemoryUnitOfWork());
    const useCase = new GetFiscalSettings(new FiscalSettingsQuery(settings));
    await expect(useCase.execute(actorOf('VIEWER'))).resolves.toEqual(DEFAULT_FISCAL_SETTINGS);
  });
});
