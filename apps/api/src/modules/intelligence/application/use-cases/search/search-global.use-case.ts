import { ENTITY_READ_RESOURCE } from '../../entity-read-resource';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  parseSearchQuery,
  searchLimit,
  type SearchableEntityType,
} from '../../../domain/search-query';
import type { SearchHit, SearchReadPort } from '../../ports/search-read.port';

/** The permission resource each indexed type is read under; a type the caller cannot read never appears. */
// The interface layer reads the type list and limits through the application, not the domain.
export {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type SearchableEntityType,
} from '../../../domain/search-query';

export const SEARCH_QUERY_MAX_CHARS = 200;

export interface SearchGlobalInput {
  /** What the user typed, prefix included. */
  readonly q: string;
  readonly entityTypes?: readonly string[];
  readonly includeArchived?: boolean;
  readonly limit?: number;
}

export interface SearchGroup {
  readonly entityType: SearchableEntityType;
  /** Matches of this type before the cap. */
  readonly total: number;
  readonly items: readonly SearchHit[];
}

export interface SearchResults {
  /** The text actually searched (prefix removed). */
  readonly query: string;
  /** Type forced by the prefix, if any. */
  readonly entityType: SearchableEntityType | null;
  readonly groups: readonly SearchGroup[];
}

const isSearchable = (value: string): value is SearchableEntityType =>
  (SEARCHABLE_ENTITY_TYPE_VALUES as readonly string[]).includes(value);

/**
 * `GET /search` (PRD §7.6, HU-26, HU-28 CA1). A type needs `read` on its resource and the others are left
 * out without an error (a Viewer simply gets no financial group, C13). The prefix wins over `entityTypes`.
 * An exact code or fiscal number answers that record alone; otherwise hits are ranked by the read port and
 * `limit` caps them in total while each group keeps its `total`. Archived rows need `includeArchived` and
 * the trash grant (C19).
 */
export class SearchGlobal {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly search: SearchReadPort,
  ) {}

  async execute(actor: CurrentUser, input: SearchGlobalInput): Promise<SearchResults> {
    const limit = searchLimit(input.limit);
    if (input.q.length > SEARCH_QUERY_MAX_CHARS) {
      throw new ValidationFailedError({
        message: 'search.validation.q',
        fieldErrors: { q: ['search.validation.q'] },
      });
    }
    const wanted = this.entityTypes(input.entityTypes);
    const parsed = parseSearchQuery(input.q);
    const empty: SearchResults = {
      query: parsed.text,
      entityType: parsed.entityType ?? null,
      groups: [],
    };
    if (parsed.text.trim() === '') return empty;

    const requested = parsed.entityType ? [parsed.entityType] : wanted;
    const types = SEARCHABLE_ENTITY_TYPE_VALUES.filter(
      (type) =>
        requested.includes(type) &&
        this.authorization.can(actor, 'read', ENTITY_READ_RESOURCE[type]),
    );
    if (types.length === 0) return empty;

    const criteria = {
      text: parsed.text,
      types,
      includeArchived:
        input.includeArchived === true && this.authorization.can(actor, 'restore', 'trash'),
    };

    const exact = await this.search.findExact(criteria);
    if (exact) {
      return { ...empty, groups: [{ entityType: exact.entityType, total: 1, items: [exact] }] };
    }

    const { hits, totals } = await this.search.search(criteria, limit);
    const groups = types
      .map((entityType): SearchGroup => ({
        entityType,
        total: totals[entityType] ?? 0,
        items: hits.filter((hit) => hit.entityType === entityType),
      }))
      .filter((group) => group.items.length > 0);
    return { ...empty, groups };
  }

  private entityTypes(raw: readonly string[] | undefined): readonly SearchableEntityType[] {
    if (raw === undefined) return SEARCHABLE_ENTITY_TYPE_VALUES;
    if (raw.length === 0 || !raw.every(isSearchable)) {
      throw new ValidationFailedError({
        message: 'search.validation.entityTypes',
        fieldErrors: { entityTypes: ['search.validation.entityTypes'] },
      });
    }
    return raw;
  }
}
