import type { EntityType } from '../../../shared/domain/enums';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { searchCondition } from '../../../shared/infrastructure/prisma/prisma-list';
import type { DbClient } from '../../../shared/infrastructure/prisma/transaction-host';

/** The `SearchEntry` columns a list `q` looks into (`data-rules.md` §7). */
const SEARCH_COLUMNS = ['code', 'title', 'subtitle', 'body'] as const;

/** Whether the list has a search text to resolve. */
export const hasSearchText = (q: string | undefined): q is string => (q?.trim() ?? '') !== '';

/**
 * `"id" IN (SELECT "entityId" FROM "SearchEntry" …)` for the list of `entityType`: the accent-folded,
 * case-insensitive "contains" of `searchCondition` over the entry's code, title, subtitle and body. It
 * leaves the archived mode to the table's own `deletedAt`, so a stale `SearchEntry.archived` never decides.
 */
export function searchEntryMatch(entityType: EntityType, q: string): Prisma.Sql {
  const text = searchCondition(SEARCH_COLUMNS, q);
  if (!text) throw new Error('searchEntryMatch requires a non-blank search text');
  return Prisma.sql`"id" IN (SELECT "entityId" FROM "SearchEntry" WHERE "entityType" = ${entityType}::"EntityType" AND (${text}))`;
}

/** `"column"::text = ANY($values)`; values are parameters, the column a whitelisted literal. */
export const anyOf = (column: string, values: readonly string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(`"${column}"`)}::text = ANY(${[...values]}::text[])`;

/** `"column" <op> $date::date` for the date-range filters. */
export const dateBound = (column: string, op: '>=' | '<=', value: Date): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(`"${column}"`)} ${Prisma.raw(op)} ${value}::date`;

export interface SearchPageSpec {
  readonly table: 'Invoice' | 'Payment' | 'Expense';
  /** Every `WHERE` condition but the search itself (filters and the archived mode). */
  readonly conditions: readonly Prisma.Sql[];
  /** The `ORDER BY` body, with its own tie-break. */
  readonly order: Prisma.Sql;
  readonly skip: number;
  readonly take: number;
}

/**
 * The ids of one page of a searched list and the total, both computed by Postgres over the same `WHERE`
 * (the search, then the filters): Node never sees the match set, only `take` ids to hydrate.
 */
export async function searchPage(
  db: DbClient,
  entityType: EntityType,
  q: string,
  spec: SearchPageSpec,
): Promise<{ ids: string[]; total: number }> {
  const table = Prisma.raw(`"${spec.table}"`);
  const where = Prisma.join([...spec.conditions, searchEntryMatch(entityType, q)], ' AND ');
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM ${table} WHERE ${where} ORDER BY ${spec.order} LIMIT ${spec.take} OFFSET ${spec.skip}`,
  );
  const counted = await db.$queryRaw<{ total: number }[]>(
    Prisma.sql`SELECT count(*)::int AS "total" FROM ${table} WHERE ${where}`,
  );
  return { ids: rows.map((row) => row.id), total: counted[0]?.total ?? 0 };
}

/** `ORDER BY` for a whitelisted column: `"column" DIR, "id" ASC`. */
export function orderBy(column: string, direction: 'asc' | 'desc'): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`"${column}"`)} ${Prisma.raw(direction === 'asc' ? 'ASC' : 'DESC')}, "id" ASC`;
}
