import { describe, expect, it } from 'vitest';
import { InMemorySettingRepository } from '../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import {
  INTEGRATION_MAPPING_KEY,
  IntegrationMappingQuery,
} from '../../settings/application/integration-mapping';
import { SettingsIntegrationMapping } from './settings-integration-mapping.adapter';

describe('SettingsIntegrationMapping', () => {
  it('is unconfigured when no row exists', async () => {
    const settings = new InMemorySettingRepository(new InMemoryUnitOfWork());
    const adapter = new SettingsIntegrationMapping(new IntegrationMappingQuery(settings));
    expect(await adapter.load()).toEqual({ stripe: null, binance: null });
  });

  it('returns the stored ids and ignores a half-configured Stripe pair', async () => {
    const settings = new InMemorySettingRepository(new InMemoryUnitOfWork());
    const adapter = new SettingsIntegrationMapping(new IntegrationMappingQuery(settings));
    settings.seed(INTEGRATION_MAPPING_KEY, {
      stripe: { accountId: 'acc_1', paymentMethodId: 'pm_1' },
      binance: { accountId: 'acc_w' },
    });
    expect(await adapter.load()).toEqual({
      stripe: { accountId: 'acc_1', paymentMethodId: 'pm_1' },
      binance: { accountId: 'acc_w' },
    });
    settings.seed(INTEGRATION_MAPPING_KEY, { stripe: { accountId: 'acc_1' }, binance: null });
    expect(await adapter.load()).toEqual({ stripe: null, binance: null });
  });
});
