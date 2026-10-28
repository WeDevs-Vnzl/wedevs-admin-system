import { Prisma } from './generated-client';
import {
  type ArchivedMode,
  type ListQuery,
  type SortDirection,
  type SortSpec,
} from '../../domain/list-query';
import { pageWindow, paginated, type Paginated } from '../../domain/pagination';
import type { DbClient } from './transaction-host';

/** A sortable column of a resource: a dotted path (relations allowed) and whether it may be NULL. */
export interface SortColumn {
  readonly path: string;
  /** NULLs sort last in both directions; only valid (and required) for nullable scalar columns. */
  readonly nullable?: boolean;
  /**
   * SQL expression ordered by when a search (`q`) is present and the list is paged in SQL. Optional for a
   * plain column (derived from `path`); required for a dotted (relation) path. Trusted code, never user text.
   */
  readonly sql?: Prisma.Sql;
}

/** Per-resource whitelist: API sort field -> column. Built by each repository. */
export type SortMap = Readonly<Record<string, SortColumn | string>>;

type OrderBy = Record<string, unknown>;

function nest(path: string, leaf: unknown): OrderBy {
  const parts = path.split('.');
  return parts.reduceRight<unknown>((inner, key) => ({ [key]: inner }), leaf) as OrderBy;
}

/** `{ deletedAt }` fragment for `archived`. `exclude` is also what the extension applies by default. */
export function archivedWhere(mode: ArchivedMode): { deletedAt?: null | { not: null } } {
  if (mode === 'exclude') return { deletedAt: null };
  if (mode === 'only') return { deletedAt: { not: null } };
  // `include`: the key must exist so the soft-delete extension leaves the query alone; Prisma ignores
  // an `undefined` filter, so every row matches.
  return { deletedAt: undefined };
}

/** `orderBy` for the requested sort (NULLs last both ways) plus an `id` tie-breaker for stable pages. */
export function buildOrderBy(
  sort: SortSpec | null,
  map: SortMap,
  defaultSort: SortSpec,
): OrderBy[] {
  const spec = sort ?? defaultSort;
  const entry = map[spec.field];
  if (entry === undefined) throw new Error(`Sort field not in the resource map: ${spec.field}`);
  const column: SortColumn = typeof entry === 'string' ? { path: entry } : entry;
  const direction: SortDirection = spec.direction;
  const leaf = column.nullable ? { sort: direction, nulls: 'last' } : direction;
  const orderBy = [nest(column.path, leaf)];
  if (column.path !== 'id') orderBy.push({ id: 'asc' });
  return orderBy;
}

/** Escapes `\`, `%` and `_` so user text is matched literally by `LIKE`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdentifier(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return Prisma.raw(`"${name}"`);
}

/**
 * Accent-folded, case-insensitive "contains" over `columns` (OR), fully parameterized:
 * `unaccent(lower(col)) LIKE '%' || unaccent(lower($q)) || '%'`. `null` when `q` is blank.
 */
export function searchCondition(
  columns: readonly string[],
  q: string | undefined,
): Prisma.Sql | null {
  const text = q?.trim();
  if (!text || columns.length === 0) return null;
  const pattern = escapeLike(text);
  const conditions = columns.map(
    (col) =>
      Prisma.sql`unaccent(lower(${quoteIdentifier(col)})) LIKE '%' || unaccent(lower(${pattern})) || '%' ESCAPE '\\'`,
  );
  return Prisma.join(conditions, ' OR ');
}

export interface ListPageSpec<T> {
  /** Table (model) name, used for the search predicate. */
  readonly table: string;
  readonly searchColumns: readonly string[];
  readonly sortMap: SortMap;
  readonly defaultSort: SortSpec;
  /** Resource filters already translated to a Prisma `where` (from `query.filters`). */
  readonly where?: Record<string, unknown>;
  /**
   * The same resource filters as SQL over the unaliased columns of `table` (values parameterized).
   * Required when `where` has keys and `query.q` is present, because the search page is selected in SQL.
   */
  readonly sqlWhere?: Prisma.Sql;
  readonly query: ListQuery;
  /** e.g. `(args) => db.client.findMany(args)`. Receives the same `where` as `count`. */
  readonly find: (args: {
    where: Record<string, unknown>;
    orderBy: OrderBy[];
    skip: number;
    take: number;
  }) => Promise<T[]>;
  readonly count: (args: { where: Record<string, unknown> }) => Promise<number>;
}

function archivedSql(mode: ArchivedMode): Prisma.Sql | null {
  if (mode === 'exclude') return Prisma.sql`"deletedAt" IS NULL`;
  if (mode === 'only') return Prisma.sql`"deletedAt" IS NOT NULL`;
  return null;
}

function sortSql(spec: SortSpec, map: SortMap): Prisma.Sql {
  const entry = map[spec.field];
  if (entry === undefined) throw new Error(`Sort field not in the resource map: ${spec.field}`);
  const column: SortColumn = typeof entry === 'string' ? { path: entry } : entry;
  let expression = column.sql;
  if (!expression) {
    if (column.path.includes('.')) {
      throw new Error(
        `Sort field ${spec.field} traverses a relation: give it an \`sql\` expression`,
      );
    }
    expression = quoteIdentifier(column.path);
  }
  const direction = Prisma.raw(spec.direction === 'desc' ? 'DESC' : 'ASC');
  const nulls = column.nullable ? Prisma.raw(' NULLS LAST') : Prisma.empty;
  const tieBreak = column.path === 'id' ? Prisma.empty : Prisma.sql`, "id" ASC`;
  return Prisma.sql`${expression} ${direction}${nulls}${tieBreak}`;
}

/** `WHERE` body shared by the page and the count statements of a search. */
export function buildSearchWhere(
  spec: Pick<ListPageSpec<unknown>, 'searchColumns' | 'sqlWhere' | 'where' | 'query'>,
): Prisma.Sql {
  const search = searchCondition(spec.searchColumns, spec.query.q);
  if (!search) throw new Error('buildSearchWhere requires a non-blank search text');
  if (!spec.sqlWhere && Object.keys(spec.where ?? {}).length > 0) {
    throw new Error('ListPageSpec.sqlWhere is required when a search is combined with filters');
  }
  const parts: Prisma.Sql[] = [];
  const archived = archivedSql(spec.query.archived);
  if (archived) parts.push(archived);
  if (spec.sqlWhere) parts.push(Prisma.sql`(${spec.sqlWhere})`);
  parts.push(Prisma.sql`(${search})`);
  return Prisma.join(parts, ' AND ');
}

/** Page-id and count statements of a search; Postgres evaluates the predicate, Node sees `pageSize` ids. */
export function buildSearchStatements(
  spec: Pick<
    ListPageSpec<unknown>,
    'table' | 'searchColumns' | 'sqlWhere' | 'where' | 'query' | 'sortMap' | 'defaultSort'
  >,
  window: { skip: number; take: number },
): { page: Prisma.Sql; count: Prisma.Sql } {
  const table = quoteIdentifier(spec.table);
  const where = buildSearchWhere(spec);
  const order = sortSql(spec.query.sort ?? spec.defaultSort, spec.sortMap);
  return {
    page: Prisma.sql`SELECT "id" FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${window.take} OFFSET ${window.skip}`,
    count: Prisma.sql`SELECT count(*)::int AS "total" FROM ${table} WHERE ${where}`,
  };
}

/**
 * Runs one list query: archived + search + filters + sort + page, with a `total` from the same where.
 * Without `q` Prisma pages and counts. With `q` Postgres evaluates the search in the same statements
 * that page and count (no id list proportional to the match set), then the page rows are hydrated by
 * at most `pageSize` ids and put back in SQL order.
 */
export async function listPage<T>(db: DbClient, spec: ListPageSpec<T>): Promise<Paginated<T>> {
  const { query } = spec;
  const orderBy = buildOrderBy(query.sort, spec.sortMap, spec.defaultSort);
  const { skip, take } = pageWindow(query.page, query.pageSize);

  if (!query.q?.trim() || spec.searchColumns.length === 0) {
    const where: Record<string, unknown> = { ...spec.where, ...archivedWhere(query.archived) };
    const items = await spec.find({ where, orderBy, skip, take });
    const total = await spec.count({ where });
    return paginated(items, total, query);
  }

  const statements = buildSearchStatements(spec, { skip, take });
  const pageRows = await db.$queryRaw<{ id: string }[]>(statements.page);
  const countRows = await db.$queryRaw<{ total: number }[]>(statements.count);
  const total = countRows[0]?.total ?? 0;
  const pageIds = pageRows.map((r) => r.id);
  if (pageIds.length === 0) return paginated([], total, query);
  const rows = await spec.find({
    where: { id: { in: pageIds }, ...archivedWhere(query.archived) },
    orderBy,
    skip: 0,
    take: pageIds.length,
  });
  const position = new Map(pageIds.map((id, i) => [id, i]));
  const items = [...rows].sort(
    (a, b) =>
      (position.get((a as { id: string }).id) ?? 0) - (position.get((b as { id: string }).id) ?? 0),
  );
  return paginated(items, total, query);
}
