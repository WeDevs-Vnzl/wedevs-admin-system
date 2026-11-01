import type { EntityType } from '../../domain/enums';
import { Prisma } from './generated-client';
import { hasSearchText, orderBy, quoteIdentifier, searchEntryMatch } from './prisma-list';
import type { DbClient } from './transaction-host';

export { hasSearchText, orderBy, searchEntryMatch };

/** `"column"::text = ANY($values)`; values are parameters, the column a whitelisted literal. */
export const anyOf = (column: string, values: readonly string[]): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(`"${column}"`)}::text = ANY(${[...values]}::text[])`;

/** `"column" <op> $date::date` for the date-range filters. */
export const dateBound = (column: string, op: '>=' | '<=', value: Date): Prisma.Sql =>
  Prisma.sql`${Prisma.raw(`"${column}"`)} ${Prisma.raw(op)} ${value}::date`;

export interface SearchPageSpec {
  /** Table (model) name of the searched list; a plain identifier, trusted code. */
  readonly table: string;
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
  const table = quoteIdentifier(spec.table);
  const where = Prisma.join([...spec.conditions, searchEntryMatch(entityType, q)], ' AND ');
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM ${table} WHERE ${where} ORDER BY ${spec.order} LIMIT ${spec.take} OFFSET ${spec.skip}`,
  );
  const counted = await db.$queryRaw<{ total: number }[]>(
    Prisma.sql`SELECT count(*)::int AS "total" FROM ${table} WHERE ${where}`,
  );
  return { ids: rows.map((row) => row.id), total: counted[0]?.total ?? 0 };
}
