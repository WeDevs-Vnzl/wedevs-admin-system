import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  assertTechnologyUnique,
  compareTechnologies,
  filterTechnologies,
  normalizeTechnology,
  slugOf,
  technologyChanges,
  type TechnologyRecord,
} from './technology';

const base = { category: 'FRONTEND' as const, active: true };

const nextJs: TechnologyRecord = {
  id: 'tec_next_js',
  name: 'Next.js',
  nameEn: null,
  slug: 'next-js',
  category: 'FRONTEND',
  iconSlug: 'nextdotjs',
  color: null,
  active: true,
};
const rust: TechnologyRecord = {
  id: 'tec_rust',
  name: 'Rust',
  nameEn: null,
  slug: 'rust',
  category: 'LENGUAJE',
  iconSlug: 'rust',
  color: '#DEA584',
  active: true,
};
const react: TechnologyRecord = {
  id: 'tec_react',
  name: 'React',
  nameEn: null,
  slug: 'react',
  category: 'FRONTEND',
  iconSlug: 'react',
  color: null,
  active: false,
};

/** Captures the `ValidationFailedError` thrown by `fn`, or fails the test when nothing is thrown. */
function validationErrorOf(fn: () => unknown): ValidationFailedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error;
    throw error;
  }
  throw new Error('expected a ValidationFailedError');
}

describe('slugOf (mock slug rule)', () => {
  it('lower-cases, dashes separators and trims dashes', () => {
    expect(slugOf('React Native')).toBe('react-native');
    expect(slugOf('  Next.js  ')).toBe('next-js');
  });

  it('spells # as sharp, so C# becomes c-sharp', () => {
    expect(slugOf('C#')).toBe('c-sharp');
  });

  it('is empty when the name has no letter or digit', () => {
    expect(slugOf('***')).toBe('');
  });
});

describe('normalizeTechnology', () => {
  it('trims the name, derives the slug from it and defaults the optional fields to null', () => {
    expect(normalizeTechnology({ ...base, name: '  Odin Lang  ', category: 'LENGUAJE' })).toEqual({
      name: 'Odin Lang',
      nameEn: null,
      slug: 'odin-lang',
      category: 'LENGUAJE',
      iconSlug: null,
      color: null,
      active: true,
    });
  });

  it('keeps an explicit slug, nameEn, icon and colour', () => {
    expect(
      normalizeTechnology({
        name: 'Next.js',
        nameEn: 'Next',
        slug: 'next-js',
        category: 'FRONTEND',
        iconSlug: 'nextdotjs',
        color: '#000000',
        active: false,
      }),
    ).toEqual({
      name: 'Next.js',
      nameEn: 'Next',
      slug: 'next-js',
      category: 'FRONTEND',
      iconSlug: 'nextdotjs',
      color: '#000000',
      active: false,
    });
  });

  it('turns a blank nameEn into null (FE optionalText)', () => {
    expect(normalizeTechnology({ ...base, name: 'Vue', nameEn: '   ' }).nameEn).toBeNull();
  });

  it('rejects a blank name with fieldErrors.name = validation.required', () => {
    const error = validationErrorOf(() => normalizeTechnology({ ...base, name: '   ' }));
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors).toEqual({ name: ['validation.required'] });
  });

  it('rejects a name or nameEn over 60 characters with validation.tooLong', () => {
    expect(
      validationErrorOf(() => normalizeTechnology({ ...base, name: 'x'.repeat(61) })).fieldErrors,
    ).toEqual({ name: ['validation.tooLong'] });
    expect(
      validationErrorOf(() => normalizeTechnology({ ...base, name: 'Vue', nameEn: 'x'.repeat(61) }))
        .fieldErrors,
    ).toEqual({ nameEn: ['validation.tooLong'] });
    expect(normalizeTechnology({ ...base, name: 'x'.repeat(60) }).name).toHaveLength(60);
  });

  it('answers VALIDATION with fieldErrors.slug when the derived slug is empty', () => {
    const error = validationErrorOf(() => normalizeTechnology({ ...base, name: '***' }));
    expect(error.fieldErrors).toEqual({ slug: ['validation.invalidFormat'] });
  });

  it('rejects an explicit slug that is not lower-case words joined by dashes', () => {
    for (const slug of ['Next JS', 'next_js', '-next', 'next-', 'next--js', '']) {
      expect(() => normalizeTechnology({ ...base, name: 'Next.js', slug }), slug).toThrow(
        ValidationFailedError,
      );
    }
  });

  it('rejects a derived slug over 60 characters', () => {
    // 58 letters + `#` becomes 58 letters + `-sharp` (64 characters).
    const error = validationErrorOf(() =>
      normalizeTechnology({ ...base, name: `${'a'.repeat(58)}#` }),
    );
    expect(error.fieldErrors).toEqual({ slug: ['validation.invalidFormat'] });
  });

  it('rejects an icon slug that is not lower-case letters and digits', () => {
    const error = validationErrorOf(() =>
      normalizeTechnology({ ...base, name: 'Vue', iconSlug: 'Vue.js' }),
    );
    expect(error.fieldErrors).toEqual({ iconSlug: ['validation.invalidFormat'] });
    expect(() => normalizeTechnology({ ...base, name: 'Vue', iconSlug: 'vue-js' })).toThrow(
      ValidationFailedError,
    );
  });

  it('accepts only a six-digit hex colour', () => {
    expect(normalizeTechnology({ ...base, name: 'Vue', color: '#4FC08D' }).color).toBe('#4FC08D');
    for (const color of ['black', '#fff', '#GGGGGG', '4FC08D']) {
      expect(() => normalizeTechnology({ ...base, name: 'Vue', color }), color).toThrow(
        ValidationFailedError,
      );
    }
  });

  it('rejects a category outside the catalog with validation.invalidOption', () => {
    const error = validationErrorOf(() =>
      normalizeTechnology({ name: 'Vue', category: 'FRAMEWORK' as never, active: true }),
    );
    expect(error.fieldErrors).toEqual({ category: ['validation.invalidOption'] });
  });
});

describe('assertTechnologyUnique (mock CONFLICT rules)', () => {
  const others = [nextJs, rust];

  it('passes when neither the name nor the slug is taken', () => {
    expect(() => assertTechnologyUnique({ name: 'Go', slug: 'go' }, others)).not.toThrow();
  });

  it('answers CONFLICT on the name, ignoring case', () => {
    try {
      assertTechnologyUnique({ name: 'next.js', slug: 'nexty' }, others);
      expect.unreachable('a taken name must conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).fieldErrors).toEqual({
        name: ['catalogs.technologies.errors.nameTaken'],
      });
    }
  });

  it('answers CONFLICT on the slug when an explicit slug is taken', () => {
    try {
      assertTechnologyUnique({ name: 'Nexty', slug: 'next-js' }, others);
      expect.unreachable('a taken slug must conflict');
    } catch (error) {
      expect((error as ConflictError).fieldErrors).toEqual({
        slug: ['catalogs.technologies.errors.slugTaken'],
      });
    }
  });

  it('reports both fields together when both are taken', () => {
    try {
      assertTechnologyUnique({ name: 'RUST', slug: 'next-js' }, others);
      expect.unreachable('both taken must conflict');
    } catch (error) {
      expect((error as ConflictError).fieldErrors).toEqual({
        name: ['catalogs.technologies.errors.nameTaken'],
        slug: ['catalogs.technologies.errors.slugTaken'],
      });
    }
  });

  it('is checked against the other rows only: a technology keeps its own name and slug', () => {
    expect(() =>
      assertTechnologyUnique({ name: 'Next.js', slug: 'next-js' }, [rust]),
    ).not.toThrow();
  });
});

describe('technologyChanges (SETTINGS_CHANGE field diff)', () => {
  it('logs only the fields that changed, by stable key', () => {
    expect(technologyChanges(nextJs, { ...nextJs, nameEn: 'Next' })).toEqual({
      nameEn: [null, 'Next'],
    });
  });

  it('is null when nothing changed', () => {
    expect(technologyChanges(nextJs, { ...nextJs })).toBeNull();
  });

  it('logs a deactivation as a boolean pair', () => {
    expect(technologyChanges(nextJs, { ...nextJs, active: false })).toEqual({
      active: [true, false],
    });
  });
});

describe('filterTechnologies (mock list filters and free text)', () => {
  const rows = [nextJs, rust, react];

  it('filters by category and by the active facet', () => {
    expect(
      filterTechnologies(rows, { categories: ['FRONTEND'], actives: undefined }).map((r) => r.name),
    ).toEqual(['Next.js', 'React']);
    expect(filterTechnologies(rows, { actives: [false] }).map((r) => r.name)).toEqual(['React']);
    expect(filterTechnologies(rows, { actives: [true, false] })).toHaveLength(3);
  });

  it('matches the free text on name, nameEn and slug, ignoring case and accents', () => {
    expect(filterTechnologies(rows, { q: 'next' }).map((r) => r.name)).toEqual(['Next.js']);
    expect(
      filterTechnologies([{ ...rust, name: 'Ruby Ñu', nameEn: null }], { q: 'ruby nu' }),
    ).toHaveLength(1);
    expect(filterTechnologies([{ ...rust, nameEn: 'Oxide' }], { q: 'oxi' })).toHaveLength(1);
    expect(filterTechnologies(rows, { q: '   ' })).toHaveLength(3);
  });
});

describe('compareTechnologies (mock sorters)', () => {
  const rows = [
    { name: 'Rust', category: 'LENGUAJE' as const, active: true, usageCount: 0 },
    { name: 'Next.js', category: 'FRONTEND' as const, active: true, usageCount: 4 },
    { name: 'React', category: 'FRONTEND' as const, active: false, usageCount: 2 },
  ];
  const sorted = (field: string, direction: 'asc' | 'desc') =>
    [...rows].sort(compareTechnologies({ field, direction })).map((r) => r.name);

  it('sorts names as Spanish text with numbers in natural order', () => {
    expect(sorted('name', 'asc')).toEqual(['Next.js', 'React', 'Rust']);
    expect(sorted('name', 'desc')).toEqual(['Rust', 'React', 'Next.js']);
  });

  it('sorts by usage count and by the active flag', () => {
    expect(sorted('usageCount', 'desc')).toEqual(['Next.js', 'React', 'Rust']);
    expect(sorted('active', 'asc')).toEqual(['React', 'Next.js', 'Rust']);
  });

  it('sorts by category and breaks ties by name, so pages are stable', () => {
    expect(sorted('category', 'asc')).toEqual(['Next.js', 'React', 'Rust']);
  });
});
