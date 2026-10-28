import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import {
  ConflictError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../shared/domain/domain-error';
import { TECH_CATEGORY_VALUES, type TechCategory } from '../../../shared/domain/enums';
import { foldText, type SortSpec } from '../../../shared/domain/list-query';

/**
 * Technology catalog (PRD §8.15 "Tecnologías", §8.3 "Stack", HU-06). Ported from
 * `fe/src/mocks/services/technologies.ts` and `fe/src/lib/validators/technologies.ts`. Pure: no Zod, no
 * framework, no clock. A technology is never soft-deleted (C19): an unused one is removed, a used one is
 * deactivated.
 */

/** Maximum lengths, counted on the trimmed value (FE `requiredText` / `optionalText`). */
export const TECHNOLOGY_LIMITS = { name: 60, nameEn: 60, slug: 60, iconSlug: 60 } as const;

/** `next-js`, `react-native`: lower-case words joined by single dashes. */
export const TECHNOLOGY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Simple Icons slug (`nextdotjs`, `postgresql`). */
export const TECHNOLOGY_ICON_SLUG_PATTERN = /^[a-z0-9]+$/;
export const TECHNOLOGY_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** i18n keys (namespace `validation` and `catalogs.technologies`), returned as they are (C1). */
const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
  invalidOption: 'validation.invalidOption',
} as const;

export const TECHNOLOGY_NAME_TAKEN_KEY = 'catalogs.technologies.errors.nameTaken';
export const TECHNOLOGY_SLUG_TAKEN_KEY = 'catalogs.technologies.errors.slugTaken';
/** `INTEGRITY_LOCK` message of a technology used by a live project (HU-06 CA3). */
export const TECHNOLOGY_IN_USE_KEY = 'catalogs.technologies.errors.inUse';

/** Fields compared for the `SETTINGS_CHANGE` activity, in the order they are recorded. */
export const TECHNOLOGY_FIELDS = [
  'name',
  'nameEn',
  'slug',
  'category',
  'iconSlug',
  'color',
  'active',
] as const;

/** Stored values of a technology, already normalized. */
export type TechnologyValues = {
  readonly name: string;
  readonly nameEn: string | null;
  readonly slug: string;
  readonly category: TechCategory;
  readonly iconSlug: string | null;
  readonly color: string | null;
  readonly active: boolean;
};

export type TechnologyRecord = TechnologyValues & { readonly id: string };

/** A technology with the number of live projects that use it (the list and detail read model). */
export type TechnologyView = TechnologyRecord & { readonly usageCount: number };

/** What a caller sends. Optional fields may be omitted or `null`; `active` defaults to true. */
export type TechnologyInput = {
  readonly name: string;
  readonly nameEn?: string | null;
  /** Derived from the name when omitted or `null`; an explicit slug is validated as given. */
  readonly slug?: string | null;
  readonly category: TechCategory;
  readonly iconSlug?: string | null;
  readonly color?: string | null;
  readonly active?: boolean;
};

/** Slug of a name, the rule of the mock: `React Native` -> `react-native`, `C#` -> `c-sharp`. */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('#', '-sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validates and normalizes a technology. Every failing field is reported together in `fieldErrors`
 * (`VALIDATION`, 422); nothing is partially accepted. A derived slug is not checked when the name is
 * already invalid, so the name error stands alone.
 */
export function normalizeTechnology(input: TechnologyInput): TechnologyValues {
  const errors: FieldErrors = {};

  const name = input.name.trim();
  const nameValid = name.length > 0 && name.length <= TECHNOLOGY_LIMITS.name;
  if (name.length === 0) errors.name = [KEYS.required];
  else if (!nameValid) errors.name = [KEYS.tooLong];

  const nameEnText = (input.nameEn ?? '').trim();
  let nameEn: string | null = null;
  if (nameEnText.length > TECHNOLOGY_LIMITS.nameEn) errors.nameEn = [KEYS.tooLong];
  else if (nameEnText.length > 0) nameEn = nameEnText;

  const slug = input.slug ?? (nameValid ? slugOf(name) : null);
  if (
    slug !== null &&
    (!TECHNOLOGY_SLUG_PATTERN.test(slug) || slug.length > TECHNOLOGY_LIMITS.slug)
  ) {
    errors.slug = [KEYS.invalidFormat];
  }

  if (!(TECH_CATEGORY_VALUES as readonly string[]).includes(input.category)) {
    errors.category = [KEYS.invalidOption];
  }

  const iconSlug = input.iconSlug ?? null;
  if (
    iconSlug !== null &&
    (!TECHNOLOGY_ICON_SLUG_PATTERN.test(iconSlug) || iconSlug.length > TECHNOLOGY_LIMITS.iconSlug)
  ) {
    errors.iconSlug = [KEYS.invalidFormat];
  }

  const color = input.color ?? null;
  if (color !== null && !TECHNOLOGY_COLOR_PATTERN.test(color)) {
    errors.color = [KEYS.invalidFormat];
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    name,
    nameEn,
    slug: slug as string,
    category: input.category,
    iconSlug,
    color,
    active: input.active ?? true,
  };
}

/**
 * `CONFLICT` when another technology already has the name (case-insensitive) or the slug. `others` are
 * the rows of the catalog except the technology being written, which may keep its own name and slug.
 */
export function assertTechnologyUnique(
  candidate: { readonly name: string; readonly slug: string },
  others: readonly { readonly name: string; readonly slug: string }[],
): void {
  const errors: FieldErrors = {};
  const name = candidate.name.toLowerCase();
  if (others.some((tech) => tech.name.toLowerCase() === name)) {
    errors.name = [TECHNOLOGY_NAME_TAKEN_KEY];
  }
  if (others.some((tech) => tech.slug === candidate.slug)) {
    errors.slug = [TECHNOLOGY_SLUG_TAKEN_KEY];
  }
  if (Object.keys(errors).length > 0) throw new ConflictError({ fieldErrors: errors });
}

/** The `SETTINGS_CHANGE` change set between two states of a technology, or `null` when nothing changed. */
export function technologyChanges(
  before: TechnologyValues,
  after: TechnologyValues,
): ActivityChanges | null {
  return diffFields(before, after, { fields: TECHNOLOGY_FIELDS });
}

/** Read filters of the catalog: a category set, an active set and free text (`q`). */
export type TechnologyFilter = {
  readonly categories?: readonly TechCategory[];
  readonly actives?: readonly boolean[];
  readonly q?: string;
};

/**
 * Keeps the rows that match every filter. Free text matches name, nameEn and slug, ignoring case and
 * accents (data-rules.md §7), like the mock's `searchText`.
 */
export function filterTechnologies<T extends TechnologyValues>(
  rows: readonly T[],
  filter: TechnologyFilter,
): T[] {
  const needle = filter.q?.trim() ? foldText(filter.q.trim()) : null;
  return rows.filter(
    (row) =>
      (filter.categories === undefined || filter.categories.includes(row.category)) &&
      (filter.actives === undefined || filter.actives.includes(row.active)) &&
      (needle === null ||
        [row.name, row.nameEn, row.slug].some(
          (text) => text !== null && foldText(text).includes(needle),
        )),
  );
}

/** The fields a technology list can be sorted by (the whitelist of the query schema). */
export type SortableTechnology = {
  readonly name: string;
  readonly category: TechCategory;
  readonly active: boolean;
  readonly usageCount?: number;
};

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/**
 * Comparator of a sort spec, as the mock sorters: Spanish text order with numbers in natural order.
 * Ties fall back to the name in ascending order, so every page of a sort is stable.
 */
export function compareTechnologies(
  sort: Pick<SortSpec, 'field' | 'direction'>,
): (a: SortableTechnology, b: SortableTechnology) => number {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const primary = (a: SortableTechnology, b: SortableTechnology): number => {
    switch (sort.field) {
      case 'usageCount':
        return (a.usageCount ?? 0) - (b.usageCount ?? 0);
      case 'active':
        return Number(a.active) - Number(b.active);
      case 'category':
        return collator.compare(a.category, b.category);
      default:
        return collator.compare(a.name, b.name);
    }
  };
  return (a, b) => direction * primary(a, b) || collator.compare(a.name, b.name);
}

/** Read model of one technology with its usage count. */
export function toTechnologyView(record: TechnologyRecord, usageCount: number): TechnologyView {
  return { ...record, usageCount };
}
