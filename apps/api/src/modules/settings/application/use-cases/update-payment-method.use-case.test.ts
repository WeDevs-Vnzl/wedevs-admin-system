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
import type { PaymentMethodSearchDependentsPort } from '../ports/payment-method-search-dependents.port';
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

/** Records the relabels and the order against the activity log; `failWith` makes the relabel throw. */
class FakeDependents implements PaymentMethodSearchDependentsPort {
  readonly calls: { methodId: string; name: string; activityEntriesSoFar: number }[] = [];
  failWith: Error | null = null;
  constructor(private readonly activity: InMemoryActivityLog) {}
  relabelMethod(methodId: string, name: string): Promise<number> {
    this.calls.push({ methodId, name, activityEntriesSoFar: this.activity.entries.length });
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(3);
  }
}

function setup() {
  const uow = new InMemoryUnitOfWork();
  const methods = new InMemoryPaymentMethodRepository(uow, [EFECTIVO, ZELLE]);
  const activity = new InMemoryActivityLog(uow);
  const dependents = new FakeDependents(activity);
  return {
    uow,
    methods,
    activity,
    dependents,
    useCase: new UpdatePaymentMethod(settingsPolicy, uow, methods, activity, dependents),
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

  describe('search entries of the dependants (DT-166, X18)', () => {
    it('runs in a Serializable unit of work, so the unit of work retries it', async () => {
      const { uow, useCase } = setup();
      await useCase.execute(actorOf('OWNER'), 'pmt_efectivo', { ...FIELDS, name: 'Efectivo VES' });
      expect(uow.lastOptions?.isolation).toBe('Serializable');
    });

    it('relabels the dependants with the new name before the activity entry', async () => {
      const { dependents, activity, useCase } = setup();
      await useCase.execute(actorOf('OWNER'), 'pmt_efectivo', { ...FIELDS, name: 'Efectivo VES' });
      expect(dependents.calls).toEqual([
        { methodId: 'pmt_efectivo', name: 'Efectivo VES', activityEntriesSoFar: 0 },
      ]);
      expect(activity.entries).toHaveLength(1);
    });

    it('relabels nothing when only nameEn, the flags or the active state change', async () => {
      const { dependents, activity, useCase } = setup();
      await useCase.execute(actorOf('OWNER'), 'pmt_efectivo', {
        ...FIELDS,
        nameEn: 'Cash',
        requiresReference: true,
        suggestsIgtf: true,
        active: false,
      });
      expect(activity.entries).toHaveLength(1);
      expect(dependents.calls).toHaveLength(0);
    });

    it('relabels nothing when nothing changed, or when the edit is refused', async () => {
      const { dependents, useCase } = setup();
      await useCase.execute(actorOf('OWNER'), 'pmt_efectivo', FIELDS);
      await useCase
        .execute(actorOf('OWNER'), 'pmt_efectivo', { ...FIELDS, name: 'zelle' })
        .catch(() => undefined);
      await useCase
        .execute(actorOf('MEMBER'), 'pmt_efectivo', { ...FIELDS, name: 'Otro' })
        .catch(() => undefined);
      expect(dependents.calls).toHaveLength(0);
    });

    it('writes neither the method nor the activity entry when the relabel fails', async () => {
      const { dependents, methods, activity, useCase } = setup();
      dependents.failWith = new Error('relabel failed');
      await expect(
        useCase.execute(actorOf('OWNER'), 'pmt_efectivo', { ...FIELDS, name: 'Efectivo VES' }),
      ).rejects.toThrow('relabel failed');
      expect(methods.rows.get('pmt_efectivo')?.name).toBe('Efectivo Bs.');
      expect(activity.entries).toHaveLength(0);
    });
  });
});
