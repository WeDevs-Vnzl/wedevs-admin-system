import { describe, expect, it } from 'vitest';
import type { ListQuery } from '../../../../shared/domain/list-query';
import { DEFAULT_LIST_QUERY } from '../../../../shared/domain/list-query';
import {
  actor,
  RUST,
  technologyWorld,
} from '../../../../../test/settings/technologies/fakes/world';
import { ListTechnologies } from './list-technologies.use-case';

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  pageSize: 100,
  ...overrides,
});

function setup() {
  const world = technologyWorld();
  const useCase = new ListTechnologies(world.technologies, world.usage);
  return { ...world, useCase };
}

describe('ListTechnologies', () => {
  it('returns the usage of each technology and sorts by it (mock usageCount sort)', async () => {
    const { useCase } = setup();
    const page = await useCase.execute(
      actor('MEMBER'),
      query({ sort: { field: 'usageCount', direction: 'desc' } }),
    );
    expect(page.items.map((t) => [t.name, t.usageCount])).toEqual([
      ['Next.js', 2],
      ['React', 0],
      ['Rust', 0],
    ]);
    expect(page.total).toBe(3);
  });

  it('is open to every signed-in role: the reference catalog (DT-71)', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('VIEWER'), query())).resolves.toMatchObject({ total: 3 });
  });

  it('sorts by name ascending by default, in Spanish text order', async () => {
    const { useCase } = setup();
    const page = await useCase.execute(actor('OWNER'), query());
    expect(page.items.map((t) => t.name)).toEqual(['Next.js', 'React', 'Rust']);
  });

  it('filters by category, by the active facet and by free text', async () => {
    const { useCase } = setup();
    const frontend = await useCase.execute(
      actor('OWNER'),
      query({ filters: { category: 'FRONTEND' } }),
    );
    expect(frontend.items.map((t) => t.name)).toEqual(['Next.js', 'React']);

    const inactive = await useCase.execute(actor('OWNER'), query({ filters: { active: 'false' } }));
    expect(inactive.items.map((t) => t.name)).toEqual(['React']);

    const found = await useCase.execute(actor('OWNER'), query({ q: 'next' }));
    expect(found.items.map((t) => t.name)).toEqual(['Next.js']);
  });

  it('accepts several categories as one filter', async () => {
    const { useCase } = setup();
    const page = await useCase.execute(
      actor('OWNER'),
      query({ filters: { category: ['LENGUAJE', 'FRONTEND'] } }),
    );
    expect(page.items.map((t) => t.name)).toEqual(['Next.js', 'React', 'Rust']);
  });

  it('pages the sorted rows and reports the total and the page count', async () => {
    const { useCase } = setup();
    const page = await useCase.execute(actor('OWNER'), query({ pageSize: 25, page: 1 }));
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
    const empty = await useCase.execute(actor('OWNER'), query({ pageSize: 25, page: 3 }));
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(3);
  });

  it('counts usage only for the rows of the page when the sort is not usage', async () => {
    const { useCase, usage, technologies } = setup();
    // 25 more rows sort before "Next.js", so page 2 (size 25) holds exactly the three originals.
    technologies.seed(
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `tec_bulk_${i}`,
        name: `Bulk ${String(i).padStart(2, '0')}`,
        nameEn: null,
        slug: `bulk-${i}`,
        category: 'OTRO' as const,
        iconSlug: null,
        color: null,
        active: true,
      })),
    );
    const counted: string[] = [];
    const original = usage.countLiveProjects.bind(usage);
    usage.countLiveProjects = async (id: string) => {
      counted.push(id);
      return original(id);
    };
    const page = await useCase.execute(actor('OWNER'), query({ pageSize: 25, page: 2 }));
    expect(page.items.map((t) => t.name)).toEqual(['Next.js', 'React', 'Rust']);
    expect(counted.sort()).toEqual(['tec_next_js', 'tec_react', 'tec_rust']);
  });

  it('returns the stored fields of each row with usageCount', async () => {
    const { useCase } = setup();
    const page = await useCase.execute(actor('OWNER'), query({ q: 'rust' }));
    expect(page.items).toEqual([{ ...RUST, usageCount: 0 }]);
  });
});
