import { describe, expect, it } from 'vitest';
import { InMemoryActivityLog } from '../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemorySettingRepository } from '../../../../test/settings/fakes/in-memory-setting.repository';
import { actorOf, settingsPolicy } from '../../../../test/settings/catalogs/fakes/catalog-actors';
import { ForbiddenError, ValidationFailedError } from '../../../shared/domain/domain-error';
import { FakeAuthorization } from '../../../../test/support/fakes/fake-authorization';
import {
  INTEGRATION_MAPPING_KEY,
  IntegrationMappingQuery,
  type IntegrationMappingReferences,
} from './integration-mapping';
import { GetIntegrationMapping, UpdateIntegrationMapping } from './integration-mapping.use-cases';

const ACCOUNTS: Record<string, { active: boolean; type: string }> = {
  acc_bank: { active: true, type: 'BANCO_INTERNACIONAL' },
  acc_wallet: { active: true, type: 'WALLET_CRIPTO' },
  acc_off: { active: false, type: 'BANCO_INTERNACIONAL' },
};
const references: IntegrationMappingReferences = {
  account: async (_actor, id) => ACCOUNTS[id] ?? null,
  methodIsActive: async (id) => id === 'pm_stripe',
};

const readPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    resource === 'settings' && (action === 'read' || user.role === 'OWNER'),
});

function setup() {
  const uow = new InMemoryUnitOfWork();
  const settings = new InMemorySettingRepository(uow);
  const activity = new InMemoryActivityLog(uow);
  const update = new UpdateIntegrationMapping(settingsPolicy, uow, settings, references, activity);
  const get = new GetIntegrationMapping(readPolicy, new IntegrationMappingQuery(settings));
  return { settings, activity, update, get, query: new IntegrationMappingQuery(settings) };
}

describe('integration mapping (DT-183, DT-184)', () => {
  it('is empty until the Owner saves it', async () => {
    const { get, query } = setup();
    const expected = { stripe: null, binance: null };
    expect(await get.execute(actorOf('MEMBER'))).toEqual(expected);
    expect(await query.read()).toEqual(expected);
  });

  it('saves the Stripe target and the Binance wallet and logs one SETTINGS_CHANGE', async () => {
    const { settings, activity, update, query } = setup();
    const saved = await update.execute(actorOf('OWNER'), {
      stripe: { accountId: 'acc_bank', paymentMethodId: 'pm_stripe' },
      binance: { accountId: 'acc_wallet' },
    });
    expect(saved).toEqual({
      stripe: { accountId: 'acc_bank', paymentMethodId: 'pm_stripe' },
      binance: { accountId: 'acc_wallet' },
    });
    expect(settings.rows.get(INTEGRATION_MAPPING_KEY)).toEqual(saved);
    expect(await query.read()).toEqual(saved);
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: INTEGRATION_MAPPING_KEY,
    });
  });

  it('writes nothing and logs nothing when the mapping did not change', async () => {
    const { settings, activity, update } = setup();
    const input = { stripe: { accountId: 'acc_bank', paymentMethodId: 'pm_stripe' } };
    await update.execute(actorOf('OWNER'), input);
    const writes = settings.saveCount;
    await update.execute(actorOf('OWNER'), input);
    expect(settings.saveCount).toBe(writes);
    expect(activity.entries).toHaveLength(1);
  });

  it('refuses a caller without the settings update grant before reading anything', async () => {
    const { settings, update } = setup();
    await expect(
      update.execute(actorOf('MEMBER'), { stripe: null, binance: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(settings.saveCount).toBe(0);
  });

  it('refuses a read without the settings read grant', async () => {
    const uow = new InMemoryUnitOfWork();
    const query = new IntegrationMappingQuery(new InMemorySettingRepository(uow));
    const denied = new GetIntegrationMapping(new FakeAuthorization({ policy: () => false }), query);
    await expect(denied.execute(actorOf('VIEWER'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each([
    [
      'unknown account',
      { stripe: { accountId: 'nope', paymentMethodId: 'pm_stripe' } },
      'stripe.accountId',
    ],
    [
      'inactive account',
      { stripe: { accountId: 'acc_off', paymentMethodId: 'pm_stripe' } },
      'stripe.accountId',
    ],
    [
      'inactive method',
      { stripe: { accountId: 'acc_bank', paymentMethodId: 'pm_old' } },
      'stripe.paymentMethodId',
    ],
    [
      'Binance account that is not a crypto wallet',
      { binance: { accountId: 'acc_bank' } },
      'binance.accountId',
    ],
    ['blank id', { binance: { accountId: ' ' } }, 'binance.accountId'],
  ])('refuses %s with a field error and writes nothing (C14)', async (_name, input, field) => {
    const { settings, update } = setup();
    const error = await update.execute(actorOf('OWNER'), input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).fieldErrors).toHaveProperty([field]);
    expect(settings.saveCount).toBe(0);
  });

  it('clears an integration by saving null', async () => {
    const { update, query } = setup();
    await update.execute(actorOf('OWNER'), { binance: { accountId: 'acc_wallet' } });
    await update.execute(actorOf('OWNER'), { binance: null });
    expect(await query.read()).toEqual({ stripe: null, binance: null });
  });
});
