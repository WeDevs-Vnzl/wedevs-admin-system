import { describe, expect, it } from 'vitest';
import {
  createTechnologyDtoSchema,
  setTechnologyActiveDtoSchema,
  technologyListQuerySchema,
  technologyViewSchema,
  updateTechnologyDtoSchema,
} from '../../../src/modules/settings/interface/http/dto/technologies.dto';

/** Shape and length only: the slug, icon and colour patterns are domain rules (answered as VALIDATION). */
describe('technology request and response DTOs', () => {
  const valid = { name: 'Next.js', category: 'FRONTEND' };

  it('create accepts a name and a category, and defaults to active', () => {
    expect(createTechnologyDtoSchema.parse(valid)).toEqual({ ...valid, active: true });
  });

  it('create accepts the optional fields, as null or absent', () => {
    expect(
      createTechnologyDtoSchema.safeParse({
        ...valid,
        nameEn: null,
        slug: 'next-js',
        iconSlug: 'nextdotjs',
        color: '#000000',
        active: false,
      }).success,
    ).toBe(true);
    expect(
      createTechnologyDtoSchema.safeParse({
        ...valid,
        nameEn: null,
        slug: null,
        iconSlug: null,
        color: null,
      }).success,
    ).toBe(true);
  });

  it('create rejects a missing name, a name over 60 characters, an unknown category and a non-boolean active', () => {
    expect(createTechnologyDtoSchema.safeParse({ category: 'FRONTEND' }).success).toBe(false);
    expect(createTechnologyDtoSchema.safeParse({ ...valid, name: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(createTechnologyDtoSchema.safeParse({ ...valid, category: 'FRAMEWORK' }).success).toBe(
      false,
    );
    expect(createTechnologyDtoSchema.safeParse({ ...valid, active: 'yes' }).success).toBe(false);
  });

  it('update takes the same full state as create', () => {
    expect(updateTechnologyDtoSchema.safeParse(valid).success).toBe(true);
    expect(updateTechnologyDtoSchema.safeParse({ ...valid, category: 'NOPE' }).success).toBe(false);
  });

  it('set-active takes exactly one boolean', () => {
    expect(setTechnologyActiveDtoSchema.safeParse({ active: false }).success).toBe(true);
    expect(setTechnologyActiveDtoSchema.safeParse({}).success).toBe(false);
    expect(setTechnologyActiveDtoSchema.safeParse({ active: 'false' }).success).toBe(false);
  });

  it('list query whitelists the sort and the page size, and defaults to name ascending', () => {
    const parsed = technologyListQuerySchema.parse({});
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: { field: 'name', direction: 'asc' },
      archived: 'exclude',
      filters: {},
    });
    expect(technologyListQuerySchema.safeParse({ sort: 'usageCount:desc' }).success).toBe(true);
    expect(technologyListQuerySchema.safeParse({ sort: 'color:asc' }).success).toBe(false);
    expect(technologyListQuerySchema.safeParse({ pageSize: '30' }).success).toBe(false);
  });

  it('list query reads the category and active facets, repeated or single', () => {
    const parsed = technologyListQuerySchema.parse({
      category: ['BACKEND', 'IA'],
      active: 'false',
    });
    expect(parsed.filters).toEqual({ category: ['BACKEND', 'IA'], active: 'false' });
    expect(technologyListQuerySchema.safeParse({ category: 'FRAMEWORK' }).success).toBe(false);
    expect(technologyListQuerySchema.safeParse({ active: 'maybe' }).success).toBe(false);
  });

  it('the response row carries the chip fields, the active flag and a non-negative usage', () => {
    const row = {
      id: 'tec_1',
      name: 'Next.js',
      nameEn: null,
      slug: 'next-js',
      category: 'FRONTEND',
      iconSlug: 'nextdotjs',
      color: null,
      active: true,
      usageCount: 4,
    };
    expect(technologyViewSchema.safeParse(row).success).toBe(true);
    expect(technologyViewSchema.safeParse({ ...row, usageCount: -1 }).success).toBe(false);
  });
});
