import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from '../domain/payment-method';
import type { PaymentMethodRepository } from './ports/payment-method.repository.port';
import { PaymentMethodCatalogQuery } from './payment-method-catalog.query';

const rows = new Map([
  ['pm_active', { id: 'pm_active', active: true, requiresReference: true, name: 'Zelle' }],
  ['pm_retired', { id: 'pm_retired', active: false, requiresReference: false, name: 'Old' }],
]) as unknown as Map<string, PaymentMethod>;

const repository = {
  findById: async (id: string) => rows.get(id) ?? null,
} as unknown as PaymentMethodRepository;

describe('PaymentMethodCatalogQuery (read for BE-3)', () => {
  const query = new PaymentMethodCatalogQuery(repository);

  it('answers only the rule fields of an active method', async () => {
    expect(await query.activeMethod('pm_active')).toEqual({
      id: 'pm_active',
      requiresReference: true,
    });
  });

  it('answers null for a retired method', async () => {
    expect(await query.activeMethod('pm_retired')).toBeNull();
  });

  it('answers null for an unknown method', async () => {
    expect(await query.activeMethod('pm_missing')).toBeNull();
  });
});
