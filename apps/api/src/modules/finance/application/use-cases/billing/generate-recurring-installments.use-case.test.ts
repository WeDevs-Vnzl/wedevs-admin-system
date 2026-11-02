import { beforeEach, describe, expect, it } from 'vitest';
import { PROJECT, createWorld, type World } from '../../../../../../test/finance/billing/world';
import { SYSTEM_ACTOR } from '../../recompute-all';

const OTHER = 'pry_otro';

let world: World;

/** A monthly USD charge billed on the 5th with 7 days of lead: its first period is generated on 2026-10-29. */
async function chargeFor(projectId: string, label: string): Promise<string> {
  await world.createCharge.execute(world.owner, {
    projectId,
    label,
    amount: '100',
    currency: 'USD',
    frequency: 'MENSUAL',
    startDate: '2026-11-01',
    billingDay: 5,
    leadDays: 7,
  });
  return world.repository.charges.find((row) => row.label === label)?.id as string;
}

const generated = (chargeId: string) =>
  world.repository.installments.filter((item) => item.recurringChargeId === chargeId);

beforeEach(() => {
  world = createWorld();
  world.projects.live.set(OTHER, {
    id: OTHER,
    code: 'PRY-0002',
    name: 'Otro',
    clientIds: ['cli_a'],
  });
  world.clock.set('2026-10-29T15:00:00.000Z');
});

describe('generating the recurring periods of the day (HU-10, DT-129)', () => {
  it('a charge that ends in a CONFLICT is listed in skippedIds and the rest of the step still runs', async () => {
    const busy = await chargeFor(PROJECT, 'Ocupado');
    const free = await chargeFor(OTHER, 'Libre');
    // A client joins the project between its unlocked read and its lock: the charge is busy for this run.
    const real = world.projects.liveProject.bind(world.projects);
    let reads = 0;
    world.projects.liveProject = async (id) => {
      const project = await real(id);
      if (id !== PROJECT) return project;
      reads += 1;
      return project && reads > 1
        ? { ...project, clientIds: [...project.clientIds, 'cli_new'] }
        : project;
    };

    expect(await world.runGeneration.execute(SYSTEM_ACTOR)).toEqual({
      created: 1,
      periodStarts: ['2026-11-05'],
      skippedIds: [busy],
    });
    expect(generated(busy)).toHaveLength(0);
    expect(generated(free).map((item) => item.periodStart)).toEqual(['2026-11-05']);
  });

  it('a charge paused between the listing and its lock generates nothing and projects nothing', async () => {
    const chargeId = await chargeFor(PROJECT, 'Soporte');
    const real = world.repository.findCharge.bind(world.repository);
    let reads = 0;
    world.repository.findCharge = async (id) => {
      const row = await real(id);
      reads += 1;
      return row && reads > 1 ? { ...row, status: 'PAUSADO' } : row;
    };
    world.projector.calls.length = 0;

    expect(await world.runGeneration.execute(SYSTEM_ACTOR)).toEqual({
      created: 0,
      periodStarts: [],
      skippedIds: [],
    });
    expect(generated(chargeId)).toHaveLength(0);
    expect(world.projector.calls).toEqual([]);
    expect(world.activity.entries.filter((entry) => entry.action === 'SYSTEM_JOB')).toHaveLength(0);
  });

  it('an active id that no longer has a charge row is ignored without a skip', async () => {
    const chargeId = await chargeFor(PROJECT, 'Soporte');
    const real = world.repository.activeChargeIds.bind(world.repository);
    world.repository.activeChargeIds = async () => [...(await real()), 'rch_gone'];

    expect(await world.runGeneration.execute(SYSTEM_ACTOR)).toEqual({
      created: 1,
      periodStarts: ['2026-11-05'],
      skippedIds: [],
    });
    expect(generated(chargeId)).toHaveLength(1);
  });

  it('a failure that is not a conflict aborts the step, so the charges after it wait for the next run', async () => {
    const first = await chargeFor(PROJECT, 'Primero');
    const second = await chargeFor(OTHER, 'Segundo');
    const real = world.projects.liveProject.bind(world.projects);
    let reads = 0;
    world.projects.liveProject = async (id) => {
      if (id === PROJECT) {
        reads += 1;
        if (reads > 1) throw new Error('database unavailable');
      }
      return real(id);
    };

    await expect(world.runGeneration.execute(SYSTEM_ACTOR)).rejects.toThrow(
      'database unavailable',
    );
    expect(generated(first)).toHaveLength(0);
    expect(generated(second)).toHaveLength(0);
  });
});
