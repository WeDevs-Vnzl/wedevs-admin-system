import { ValidationFailedError } from './domain-error';
import { DEFAULT_PAGE_SIZE, type PageSize } from './pagination';

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  readonly field: string;
  readonly direction: SortDirection;
}

export type ArchivedMode = 'exclude' | 'only' | 'include';

/** Resource-specific filters: a single value or repeated values per name. */
export type ListFilters = Readonly<Record<string, string | readonly string[]>>;

/** Framework-free list query (`api-contract.md` §3). */
export interface ListQuery {
  readonly page: number;
  readonly pageSize: PageSize;
  readonly sort: SortSpec | null;
  readonly q?: string;
  readonly archived: ArchivedMode;
  readonly filters: ListFilters;
}

export const DEFAULT_LIST_QUERY: ListQuery = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: null,
  archived: 'exclude',
  filters: {},
};

/** One sort token: `field:asc|desc`, dotted paths allowed (`api-contract.md` §3). */
export const SORT_TOKEN = /^([A-Za-z][A-Za-z0-9_.]*):(asc|desc)$/;

/** Splits a `field:asc|desc` string; `null` when missing or malformed. */
export function parseSort(sort: string | undefined | null): SortSpec | null {
  if (!sort) return null;
  const match = SORT_TOKEN.exec(sort);
  if (!match) return null;
  return { field: match[1] as string, direction: match[2] as SortDirection };
}

/**
 * Resolves the requested sort against a per-resource whitelist. No request means the default; a
 * malformed sort or a field outside the whitelist is a `VALIDATION` error with
 * `fieldErrors.sort = ["validation.sort.invalid"]`.
 */
export function resolveSort(
  requested: string | undefined | null,
  whitelist: readonly string[],
  defaultSort: SortSpec,
): SortSpec {
  if (requested === undefined || requested === null || requested === '') return defaultSort;
  const parsed = parseSort(requested);
  if (!parsed || !whitelist.includes(parsed.field)) {
    throw new ValidationFailedError({ fieldErrors: { sort: ['validation.sort.invalid'] } });
  }
  return parsed;
}

/** Lower-case and accent-fold a text, so `"Cotizacion"` matches `"Cotización"` (data-rules.md §7). */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
