import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/domain/domain-error';
import {
  actor,
  NEXT_JS,
  RUST,
  technologyWorld,
} from '../../../../../test/settings/technologies/fakes/world';
import { UpdateTechnology } from './update-technology.use-case';

function setup() {
  const world = technologyWorld();
  const useCase = new UpdateTechnology(
    world.authorization,
    world.uow,
    world.technologies,
    world.activity,
    world.usage,
  );
  return { ...world, useCase };
}

const nextInput = {
  id: NEXT_JS.id,
  name: 'Next.js',
  nameEn: 'Next',
  slug: NEXT_JS.slug,
  category: 'FRONTEND' as const,
  iconSlug: NEXT_JS.iconSlug,
  color: null,
  active: true,
};

describe('UpdateTechnology', () => {
  it('keeps its own name and slug and logs only the changed fields (mock updateTechnology)', async () => {
    const { useCase, activity } = setup();
    const dto = await useCase.execute(actor('OWNER'), nextInput);
    expect(dto).toMatchObject({ nameEn: 'Next', usageCount: 2 });
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: NEXT_JS.id,
      entityLabel: 'Next.js',
      changes: { nameEn: [null, 'Next'] },
    });
  });

  it('answers CONFLICT when another technology has the name', async () => {
    const { useCase, technologies } = setup();
    const before = technologies.writeCount;
    await expect(
      useCase.execute(actor('OWNER'), { ...nextInput, name: 'RUST', slug: 'next-js' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(technologies.writeCount).toBe(before);
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...nextInput, id: 'tec_missing' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes nothing and logs nothing when no field changed', async () => {
    const { useCase, technologies, activity } = setup();
    await useCase.execute(actor('OWNER'), { ...nextInput, nameEn: 'Next' });
    const writes = technologies.writeCount;
    const entries = activity.entries.length;
    await useCase.execute(actor('OWNER'), { ...nextInput, nameEn: '  Next  ' });
    expect(technologies.writeCount).toBe(writes);
    expect(activity.entries).toHaveLength(entries);
  });

  it('lets a Member not write: FORBIDDEN, nothing stored', async () => {
    const { useCase, technologies, activity } = setup();
    await expect(useCase.execute(actor('MEMBER'), nextInput)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(technologies.writeCount).toBe(0);
    expect(activity.entries).toHaveLength(0);
  });

  it('answers VALIDATION and keeps the row when the new slug is malformed', async () => {
    const { useCase, technologies } = setup();
    await expect(
      useCase.execute(actor('ADMIN'), { ...nextInput, slug: 'Next JS' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(technologies.rows.find((t) => t.id === NEXT_JS.id)?.slug).toBe('next-js');
  });

  it('can reuse the name of a technology it renames away from (no self conflict)', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...nextInput, id: RUST.id, name: 'rust', slug: 'rust' }),
    ).resolves.toMatchObject({ name: 'rust' });
  });
});
