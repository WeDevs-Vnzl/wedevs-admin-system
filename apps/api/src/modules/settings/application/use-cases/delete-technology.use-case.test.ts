import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import {
  actor,
  NEXT_JS,
  RUST,
  technologyWorld,
} from '../../../../../test/settings/technologies/fakes/world';
import { DeleteTechnology } from './delete-technology.use-case';

function setup() {
  const world = technologyWorld();
  const useCase = new DeleteTechnology(
    world.authorization,
    world.uow,
    world.technologies,
    world.activity,
    world.usage,
  );
  return { ...world, useCase };
}

describe('DeleteTechnology', () => {
  it('locks a technology that a live project uses, and keeps the row (HU-06 CA3, mock key)', async () => {
    const { useCase, technologies, usage } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: NEXT_JS.id })).rejects.toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'catalogs.technologies.errors.inUse',
    });
    await expect(useCase.execute(actor('OWNER'), { id: NEXT_JS.id })).rejects.toBeInstanceOf(
      IntegrityLockedError,
    );
    expect(technologies.rows.some((t) => t.id === NEXT_JS.id)).toBe(true);
    expect(usage.detached).toEqual([]);
  });

  it('removes an unused technology inside one unit of work: detach, delete, activity', async () => {
    const { useCase, technologies, usage, activity, uow } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: RUST.id })).resolves.toEqual({
      id: RUST.id,
    });
    expect(technologies.rows.some((t) => t.id === RUST.id)).toBe(false);
    expect(usage.detached).toEqual([RUST.id]);
    expect(uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(activity.entries.at(-1)).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: RUST.id,
      entityLabel: 'Rust',
      changes: { technology: ['Rust', null] },
    });
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('OWNER'), { id: 'tec_missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses a Member: FORBIDDEN and nothing is removed', async () => {
    const { useCase, technologies } = setup();
    await expect(useCase.execute(actor('MEMBER'), { id: RUST.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(technologies.rows.some((t) => t.id === RUST.id)).toBe(true);
  });
});
