import { ValidationFailedError } from '../../../shared/domain/domain-error';

/** Entities in the search index (data-rules §7). */
export const SEARCHABLE_ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'ACCOUNT',
  'DOCUMENT',
  'NOTE',
] as const;
export type SearchableEntityType = (typeof SEARCHABLE_ENTITY_TYPE_VALUES)[number];

/** `c:` clients, `p:` projects, `f:` invoices, `d:` documents, `n:` notes (PRD §7.6). */
export const SEARCH_PREFIXES = {
  c: 'CLIENT',
  p: 'PROJECT',
  f: 'INVOICE',
  d: 'DOCUMENT',
  n: 'NOTE',
} as const satisfies Record<string, SearchableEntityType>;
export type SearchPrefix = keyof typeof SEARCH_PREFIXES;

export type ParsedSearchQuery = {
  /** The text to search, without the prefix. */
  text: string;
  /** Entity type forced by the prefix, if any. */
  entityType?: SearchableEntityType;
};

/** Splits a typed query like `c: acme` into the text and the entity type its prefix selects. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const match = /^\s*([a-z]):\s*(.*)$/i.exec(raw);
  const prefix = match?.[1]?.toLowerCase();
  if (match && prefix !== undefined && Object.hasOwn(SEARCH_PREFIXES, prefix)) {
    return { text: (match[2] ?? '').trim(), entityType: SEARCH_PREFIXES[prefix as SearchPrefix] };
  }
  return { text: raw.trim() };
}

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Total results of one search: 20 by default, 1 to 50. */
export function searchLimit(limit: number | undefined): number {
  if (limit === undefined) return SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw new ValidationFailedError({
      message: 'search.validation.limit',
      fieldErrors: { limit: ['search.validation.limit'] },
    });
  }
  return limit;
}
