import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationFailedError,
} from '../../../../shared/domain/domain-error';
import { actor, technologyWorld } from '../../../../../test/settings/technologies/fakes/world';
import { CreateTechnology } from './create-technology.use-case';

const input = { name: 'Odin Lang', category: 'LENGUAJE' as const, active: true };

function setup() {
  const world = technologyWorld();
  const useCase = new CreateTechnology(
    world.authorization,
    world.uow,
    world.technologies,
    world.activity,
    world.ids,
  );
  return { ...world, useCase };
}

describe('CreateTechnology', () => {
  it('derives the slug from the name and logs one SETTINGS_CHANGE (mock createTechnology)', async () => {
    const { useCase, technologies, activity } = setup();
    const dto = await useCase.execute(actor('OWNER'), input);
    expect(dto).toEqual({
      id: 'tec_new_1',
      name: 'Odin Lang',
      nameEn: null,
      slug: 'odin-lang',
      category: 'LENGUAJE',
      iconSlug: null,
      color: null,
      active: true,
      usageCount: 0,
    });
    expect(technologies.rows.map((t) => t.id)).toContain('tec_new_1');
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      actor: { actorType: 'USER', userId: 'usr_owner' },
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'tec_new_1',
      entityLabel: 'Odin Lang',
      changes: { technology: [null, 'Odin Lang'] },
    });
  });

  it('answers CONFLICT with the name field when the name exists, ignoring case, and writes nothing', async () => {
    const { useCase, technologies, activity } = setup();
    const before = technologies.writeCount;
    await expect(
      useCase.execute(actor('OWNER'), { name: 'next.js', category: 'FRONTEND', active: true }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['catalogs.technologies.errors.nameTaken'] },
    });
    expect(technologies.writeCount).toBe(before);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers CONFLICT with the slug field when an explicit slug is taken', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('ADMIN'), {
        name: 'Nexty',
        slug: 'next-js',
        category: 'FRONTEND',
        active: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a derived slug that is empty with VALIDATION', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { name: '***', category: 'OTRO', active: true }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('lets an Admin create (settings grant, PRD §4.3)', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('ADMIN'), input)).resolves.toMatchObject({
      name: 'Odin Lang',
    });
  });

  it('refuses a Member with FORBIDDEN before anything else, and writes nothing', async () => {
    const { useCase, technologies, activity } = setup();
    const before = technologies.writeCount;
    await expect(
      useCase.execute(actor('MEMBER'), { name: 'Next.js', category: 'FRONTEND', active: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(technologies.writeCount).toBe(before);
    expect(activity.entries).toHaveLength(0);
  });

  it('writes the row and its activity in one Serializable unit of work', async () => {
    const { useCase, uow, activity } = setup();
    await useCase.execute(actor('OWNER'), input);
    expect(uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(activity.entries).toHaveLength(1);
  });
});
