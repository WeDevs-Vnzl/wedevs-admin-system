import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../../../../test/support/fakes/sequential-id-generator';
import { InMemoryPaymentMethodRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-payment-method.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { PaymentMethod } from '../../domain/payment-method';
import { CreatePaymentMethod } from './create-payment-method.use-case';

const ZELLE: PaymentMethod = {
  id: 'pmt_seed',
  code: 'ZELLE',
  name: 'Zelle',
  nameEn: null,
  requiresReference: true,
  suggestsIgtf: false,
  active: true,
};

function setup() {
  const uow = new InMemoryUnitOfWork();
  const methods = new InMemoryPaymentMethodRepository(uow, [ZELLE]);
  const activity = new InMemoryActivityLog(uow);
  const useCase = new CreatePaymentMethod(
    settingsPolicy,
    uow,
    methods,
    new SequentialIdGenerator('pmt'),
    activity,
  );
  return { methods, activity, useCase };
}

describe('CreatePaymentMethod', () => {
  it('creates a method with a generated id and a stable code, and logs one SETTINGS_CHANGE', async () => {
    const { methods, activity, useCase } = setup();
    const created = await useCase.execute(actorOf('OWNER'), {
      code: 'BINANCE_PAY',
      name: 'Binance Pay',
      requiresReference: true,
      suggestsIgtf: false,
      active: true,
    });
    expect(created).toEqual({
      id: 'pmt_1',
      code: 'BINANCE_PAY',
      name: 'Binance Pay',
      nameEn: null,
      requiresReference: true,
      suggestsIgtf: false,
      active: true,
    });
    expect(methods.rows.get('pmt_1')).toEqual(created);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'pmt_1',
      changes: { paymentMethod: [null, 'BINANCE_PAY'] },
    });
  });

  it('refuses a repeated code and a repeated name (case-insensitive) with CONFLICT on both', async () => {
    const { methods, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('ADMIN'), { code: 'ZELLE', name: 'zelle' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: {
        code: ['catalogs.paymentMethods.errors.codeTaken'],
        name: ['catalogs.paymentMethods.errors.nameTaken'],
      },
    });
    expect(methods.rows.size).toBe(1);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('MEMBER'), { code: 'PAGO_MOVIL', name: 'Pago Móvil' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
