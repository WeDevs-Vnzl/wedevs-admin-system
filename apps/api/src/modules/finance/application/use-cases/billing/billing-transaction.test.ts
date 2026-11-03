import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT,
  PROJECT,
  createWorld,
  rejection,
  type World,
} from '../../../../../../test/finance/billing/world';
import { BillingTransaction } from './billing-transaction';

let world: World;

const schedule = (over: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  label: 'Soporte',
  amount: '100',
  currency: 'USD',
  frequency: 'MENSUAL' as const,
  startDate: '2026-11-01',
  billingDay: 5,
  leadDays: 7,
  ...over,
});

beforeEach(() => {
  world = createWorld();
});

describe('the project-scoped transaction of billing (Q-BE3-1, C14, C18)', () => {
  it('requireProject answers the live project and NOT_FOUND for an unknown or archived one', async () => {
    const tx = new BillingTransaction(
      world.uow,
      world.locks,
      world.projects,
      world.projector,
      world.activity,
    );
    expect(await tx.requireProject(PROJECT)).toMatchObject({ id: PROJECT, clientIds: [CLIENT] });
    expect((await rejection(tx.requireProject('pry_missing'))).code).toBe('NOT_FOUND');
    world.projects.live.delete(PROJECT);
    expect((await rejection(tx.requireProject(PROJECT))).code).toBe('NOT_FOUND');
  });

  it('a project archived between the read and the lock is NOT_FOUND and writes nothing', async () => {
    const real = world.projects.liveProject.bind(world.projects);
    let reads = 0;
    world.projects.liveProject = async (id) => {
      reads += 1;
      return reads > 1 ? null : real(id);
    };

    expect((await rejection(world.createCharge.execute(world.owner, schedule()))).code).toBe(
      'NOT_FOUND',
    );
    expect(world.repository.charges).toHaveLength(0);
    expect(world.projector.calls).toEqual([]);
    expect(world.activity.entries).toHaveLength(0);
  });

  it('a project without clients logs its activity with no client scope', async () => {
    world.projects.live.set(PROJECT, {
      id: PROJECT,
      code: 'PRY-0001',
      name: 'Solaris',
      clientIds: [],
    });

    await world.createCharge.execute(world.owner, schedule());

    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'CREATE',
      entityType: 'RECURRING_CHARGE',
      clientId: null,
      touchClientIds: [],
    });
    expect(world.projector.calls).toEqual([
      { method: 'projectClients', ids: [] },
      { method: 'projectProjects', ids: [PROJECT] },
    ]);
  });
});
