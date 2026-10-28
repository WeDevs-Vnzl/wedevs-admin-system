import { describe, expect, it } from 'vitest';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryPaymentMethodRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-payment-method.repository';
import { actorOf } from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { PaymentMethod } from '../../domain/payment-method';
import { ListPaymentMethods } from './list-payment-methods.use-case';

const method = (id: string, name: string, active = true): PaymentMethod => ({
  id,
  code: id.toUpperCase(),
  name,
  nameEn: null,
  requiresReference: true,
  suggestsIgtf: false,
  active,
});

const SEED = [
  method('zelle', 'Zelle'),
  method('efectivo', 'Efectivo Bs.', false),
  method('pm', 'Pago Móvil'),
];

function setup() {
  const uow = new InMemoryUnitOfWork();
  return new ListPaymentMethods(new InMemoryPaymentMethodRepository(uow, SEED));
}

describe('ListPaymentMethods', () => {
  it('lists the active methods by default, ordered by name', async () => {
    const names = (await setup().execute(actorOf('MEMBER'), { includeInactive: false })).map(
      (m) => m.name,
    );
    expect(names).toEqual(['Pago Móvil', 'Zelle']);
  });

  it('lists every method with includeInactive (Settings)', async () => {
    const all = await setup().execute(actorOf('OWNER'), { includeInactive: true });
    expect(all).toHaveLength(SEED.length);
  });
});
