import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryPaymentMethodRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-payment-method.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { PaymentMethod } from '../../domain/payment-method';
import { UpdatePaymentMethod } from './update-payment-method.use-case';

const EFECTIVO: PaymentMethod = {
  id: 'pmt_efectivo',
  code: 'EFECTIVO_VES',
  name: 'Efectivo Bs.',
  nameEn: null,
  requiresReference: false,
  suggestsIgtf: false,
  active: true,
};
const ZELLE: PaymentMethod = { ...EFECTIVO, id: 'pmt_zelle', code: 'ZELLE', name: 'Zelle' };

function setup() {
  const uow = new InMemoryUnitOfWork();
  const methods = new InMemoryPaymentMethodRepository(uow, [EFECTIVO, ZELLE]);
  const activity = new InMemoryActivityLog(uow);
  return {
    methods,
    activity,
    useCase: new UpdatePaymentMethod(settingsPolicy, uow, methods, activity),
  };
}

const FIELDS = {
  name: 'Efectivo Bs.',
  nameEn: null,
  requiresReference: false,
  suggestsIgtf: false,
  active: true,
};

describe('UpdatePaymentMethod', () => {
  it('updates the flags and keeps the code (DT-70: suggestsIgtf), and logs the changed fields', async () => {
    const { methods, activity, useCase } = setup();
    const updated = await useCase.execute(actorOf('OWNER'), 'pmt_efectivo', {
      ...FIELDS,
      name: 'Efectivo Bs',
      suggestsIgtf: true,
      active: false,
    });
    expect(updated).toMatchObject({
      id: 'pmt_efectivo',
      code: 'EFECTIVO_VES',
      suggestsIgtf: true,
      active: false,
    });
    expect(methods.rows.get('pmt_efectivo')).toEqual(updated);
    expect(activity.entries[0]?.changes).toEqual({
      name: ['Efectivo Bs.', 'Efectivo Bs'],
      suggestsIgtf: [false, true],
      active: [true, false],
    });
  });

  it('lets a method keep its own name, and writes nothing when nothing changed', async () => {
    const { activity, useCase } = setup();
    await useCase.execute(actorOf('ADMIN'), 'pmt_efectivo', FIELDS);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses another method name with CONFLICT on the name', async () => {
    const { activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'pmt_efectivo', { ...FIELDS, name: 'zelle' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'pmt_missing', { ...FIELDS, name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actorOf('MEMBER'), 'pmt_efectivo', FIELDS)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
