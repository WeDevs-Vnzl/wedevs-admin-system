import type { CurrentUser } from '../../../../shared/application/current-user';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import { foldText, type SortSpec } from '../../../../shared/domain/list-query';
import { paginated, type Paginated } from '../../../../shared/domain/pagination';
import {
  categoryRef,
  compareCatalogText,
  DocumentTypeCatalog,
  type DocumentTypeDetailView,
} from '../document-type-catalog';

export const DOCUMENT_TYPE_SORT_FIELDS = ['name', 'category', 'documentCount', 'active'] as const;

/** Resolved list query of `GET /document-types` (the DTO applies the defaults and the whitelist). */
export interface DocumentTypeListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SortSpec;
  readonly q?: string;
  readonly categoryId?: readonly string[];
  readonly active?: boolean;
  readonly requiresSignature?: boolean;
  readonly hasExpiration?: boolean;
}

type SortValue = string | number | boolean;

const SORTERS: Record<
  (typeof DOCUMENT_TYPE_SORT_FIELDS)[number],
  (row: DocumentTypeDetailView) => SortValue
> = {
  name: (row) => row.name,
  category: (row) => row.category.name,
  documentCount: (row) => row.documentCount,
  active: (row) => row.active,
};

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'string' && typeof b === 'string') return compareCatalogText(a, b);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * `GET /document-types`: the types with their category and document count, filtered, searched, sorted and
 * paged. Reads carry `@Authenticated()` (DT-71), so the use case runs no `can()`. The catalog is small
 * (DT-107), so the filters, the search and the sort run here over the loaded rows, as the mock does. Ties
 * are broken by name, then id, so every page is stable.
 */
export class ListDocumentTypes {
  constructor(private readonly catalog: DocumentTypeCatalog) {}

  async execute(
    _actor: CurrentUser,
    query: DocumentTypeListQuery,
  ): Promise<Paginated<DocumentTypeDetailView>> {
    const field = query.sort.field as (typeof DOCUMENT_TYPE_SORT_FIELDS)[number];
    if (!(DOCUMENT_TYPE_SORT_FIELDS as readonly string[]).includes(field)) {
      throw new ValidationFailedError({ fieldErrors: { sort: ['validation.sort.invalid'] } });
    }
    const categories = new Map(
      (await this.catalog.listCategories()).map((c) => [c.id, c] as const),
    );
    const needle = query.q ? foldText(query.q) : null;

    const rows: DocumentTypeDetailView[] = [];
    for (const type of await this.catalog.listTypes()) {
      const category = categories.get(type.categoryId);
      if (!category) continue;
      if (query.categoryId && !query.categoryId.includes(type.categoryId)) continue;
      if (query.active !== undefined && type.active !== query.active) continue;
      if (
        query.requiresSignature !== undefined &&
        type.requiresSignature !== query.requiresSignature
      )
        continue;
      if (query.hasExpiration !== undefined && type.hasExpiration !== query.hasExpiration) continue;
      const matches =
        needle === null ||
        [type.name, type.nameEn, category.name].some(
          (text) => text !== null && foldText(text).includes(needle),
        );
      if (!matches) continue;
      rows.push({ ...(await this.catalog.typeView(type)), category: categoryRef(category) });
    }

    const sorter = SORTERS[field];
    const direction = query.sort.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const ordered = direction * compareValues(sorter(a), sorter(b));
      if (ordered !== 0) return ordered;
      return compareCatalogText(a.name, b.name) || compareCatalogText(a.id, b.id);
    });

    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
  }
}
