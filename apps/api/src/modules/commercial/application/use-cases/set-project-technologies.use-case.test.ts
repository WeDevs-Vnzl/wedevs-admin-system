import { describe, expect, it } from 'vitest';
import {
  actor,
  NEXT_JS,
  projectRecord,
  projectWorld,
  REACT,
  RUST,
} from '../../../../../test/commercial/projects/fakes/world';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';

function world(technologyIds: string[] = []) {
  const w = projectWorld();
  w.projects.seed(projectRecord({ technologyIds }));
  return w;
}

describe('SetProjectTechnologies (mock setProjectTechnologies, HU-06 CA1)', () => {
  it('replaces the stack and logs the sorted names before and after', async () => {
    const w = world([RUST.id]);
    const detail = await w.setProjectTechnologies.execute(actor('MEMBER'), {
      id: 'pry_kairos_web',
      technologyIds: [NEXT_JS.id, RUST.id],
    });
    expect(detail.stack.map((t) => t.name)).toEqual(['Next.js', 'Rust']);
    expect(w.activity.entries).toHaveLength(1);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'UPDATE',
      changes: { technologyIds: ['Rust', 'Next.js, Rust'] },
    });
  });

  it('accepts active technologies only: unknown and inactive fail on technologyIds', async () => {
    const w = world();
    await expect(
      w.setProjectTechnologies.execute(actor('OWNER'), {
        id: 'pry_kairos_web',
        technologyIds: ['tec_ghost'],
      }),
    ).rejects.toMatchObject({
      fieldErrors: { technologyIds: ['projects.errors.technologyUnknown'] },
    });
    await expect(
      w.setProjectTechnologies.execute(actor('OWNER'), {
        id: 'pry_kairos_web',
        technologyIds: [REACT.id],
      }),
    ).rejects.toMatchObject({
      fieldErrors: { technologyIds: ['projects.errors.technologyInactive'] },
    });
    expect(w.projects.writeCount).toBe(0);
  });

  it('keeps an inactive technology the project already carries', async () => {
    const w = world([REACT.id]);
    const detail = await w.setProjectTechnologies.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      technologyIds: [REACT.id, NEXT_JS.id],
    });
    expect(detail.stack.map((t) => t.id).sort()).toEqual([NEXT_JS.id, REACT.id].sort());
  });

  it('can empty the stack and writes nothing when it is unchanged', async () => {
    const w = world([NEXT_JS.id]);
    const same = await w.setProjectTechnologies.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      technologyIds: [NEXT_JS.id],
    });
    expect(same.stack).toHaveLength(1);
    expect(w.activity.entries).toHaveLength(0);

    const empty = await w.setProjectTechnologies.execute(actor('OWNER'), {
      id: 'pry_kairos_web',
      technologyIds: [],
    });
    expect(empty.stack).toEqual([]);
    expect(w.activity.entries[0]?.changes).toEqual({ technologyIds: ['Next.js', ''] });
  });

  it('refuses a Viewer and an unknown project', async () => {
    const w = world();
    await expect(
      w.setProjectTechnologies.execute(actor('VIEWER'), {
        id: 'pry_kairos_web',
        technologyIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.setProjectTechnologies.execute(actor('OWNER'), { id: 'pry_ghost', technologyIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
