import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT,
  createWorld,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';
import type { InstallmentTemplate } from '../../../domain/installments';
import type { InstallmentDraftInput } from './apply-installment-template.use-case';

let world: World;

const draft = (over: Partial<InstallmentDraftInput> = {}): InstallmentDraftInput => ({
  kind: 'CUOTA',
  label: 'Cuota',
  amount: '100',
  currency: 'USD',
  ...over,
});

/** A `CUSTOM` template with the given drafts, applied to the project's plan. */
const custom = (...drafts: InstallmentDraftInput[]) =>
  world.applyTemplate.execute(world.owner, {
    projectId: PROJECT,
    template: 'CUSTOM',
    installments: drafts,
  });

async function planned(): Promise<void> {
  await world.upsertPlan.execute(world.owner, {
    projectId: PROJECT,
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '10000',
  });
}

beforeEach(() => {
  world = createWorld();
});

describe('draft rules of a template (HU-09 CA1)', () => {
  it('a draft with a percentage above 100 is a field error on that draft', async () => {
    await planned();
    const error = await rejection(custom(draft({ percentage: '150' })));
    expect(error.fieldErrors).toEqual({
      'installments.0.percentage': ['validation.money.invalid'],
    });
    expect(world.repository.installments).toHaveLength(0);
  });

  it('a draft with a date that is not a date is a field error on that draft', async () => {
    await planned();
    const error = await rejection(custom(draft({ dueDate: 'not-a-date' })));
    expect(error.fieldErrors).toEqual({ 'installments.0.dueDate': ['validation.date.invalid'] });
  });

  it('a draft trigger longer than 200 characters is a field error on that draft', async () => {
    await planned();
    const error = await rejection(custom(draft({ trigger: 'x'.repeat(201) })));
    expect(error.fieldErrors).toEqual({ 'installments.0.trigger': ['validation.required'] });
  });

  it('an unknown template is a field error on template and nothing is written', async () => {
    await planned();
    const error = await rejection(
      world.applyTemplate.execute(world.owner, {
        projectId: PROJECT,
        template: 'NOPE' as InstallmentTemplate,
      }),
    );
    expect(error.fieldErrors).toEqual({ template: ['validation.required'] });
    expect(world.repository.installments).toHaveLength(0);
  });

  it('more than 60 custom drafts is a field error on installments', async () => {
    await planned();
    const error = await rejection(custom(...Array.from({ length: 61 }, () => draft())));
    expect(error.fieldErrors?.installments).toEqual(['validation.required']);
    expect(world.repository.installments).toHaveLength(0);
  });
});

describe('the plan and the pending installments are read again under the lock', () => {
  it('a plan that vanishes before the lock is a field error and writes nothing', async () => {
    await planned();
    const real = world.repository.findPlan.bind(world.repository);
    let reads = 0;
    world.repository.findPlan = async (projectId) => {
      reads += 1;
      return reads > 1 ? null : real(projectId);
    };

    const error = await rejection(custom(draft()));
    expect(error.fieldErrors).toEqual({ projectId: ['billing.errors.planRequired'] });
    expect(world.repository.installments).toHaveLength(0);
  });

  it('a pending template installment that appears after the unlocked read is a CONFLICT and writes nothing', async () => {
    await planned();
    await custom(draft({ label: 'Uno', amount: '10000' }));
    const [pending] = world.repository.installments;
    if (!pending) throw new Error('the setup must create one pending installment');
    // A concurrent commit adds a pending installment of the plan after the unlocked read, before the lock.
    const late = { ...pending, id: 'ins_late' };
    const realLock = world.locks.lock.bind(world.locks);
    let locked = false;
    world.locks.lock = async (set) => {
      await realLock(set);
      locked = true;
    };
    const realList = world.repository.listInstallments.bind(world.repository);
    world.repository.listInstallments = async (projectId) => {
      const rows = await realList(projectId);
      return locked ? [...rows, late] : rows;
    };
    const before = world.repository.installments.map((item) => [item.id, item.status]);

    expect((await rejection(custom(draft({ label: 'Otra', amount: '5000' })))).code).toBe(
      'CONFLICT',
    );
    expect(world.repository.installments.map((item) => [item.id, item.status])).toEqual(before);
    expect(
      world.activity.entries.filter(
        (entry) => entry.entityType === 'INSTALLMENT' && entry.action === 'CREATE',
      ),
    ).toHaveLength(1);
  });
});
