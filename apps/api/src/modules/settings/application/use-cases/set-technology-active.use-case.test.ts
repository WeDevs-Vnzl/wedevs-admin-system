import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';
import {
  actor,
  NEXT_JS,
  REACT,
  technologyWorld,
} from '../../../../../test/settings/technologies/fakes/world';
import { SetTechnologyActive } from './set-technology-active.use-case';

function setup() {
  const world = technologyWorld();
  const useCase = new SetTechnologyActive(
    world.authorization,
    world.uow,
    world.technologies,
    world.activity,
    world.usage,
  );
  return { ...world, useCase };
}

describe('SetTechnologyActive', () => {
  it('deactivates and reactivates, logging each change (mock setTechnologyActive)', async () => {
    const { useCase, activity } = setup();
    const off = await useCase.execute(actor('OWNER'), { id: NEXT_JS.id, active: false });
    expect(off).toMatchObject({ active: false, usageCount: 2 });
    expect(activity.entries.at(-1)?.changes).toEqual({ active: [true, false] });

    const on = await useCase.execute(actor('ADMIN'), { id: NEXT_JS.id, active: true });
    expect(on.active).toBe(true);
    expect(activity.entries.at(-1)?.changes).toEqual({ active: [false, true] });
  });

  it('logs nothing and writes nothing when the value does not change', async () => {
    const { useCase, technologies, activity } = setup();
    const result = await useCase.execute(actor('OWNER'), { id: REACT.id, active: false });
    expect(result.active).toBe(false);
    expect(technologies.writeCount).toBe(0);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { id: 'tec_missing', active: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a Member with FORBIDDEN and changes nothing', async () => {
    const { useCase, technologies } = setup();
    await expect(
      useCase.execute(actor('MEMBER'), { id: NEXT_JS.id, active: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(technologies.writeCount).toBe(0);
  });
});
