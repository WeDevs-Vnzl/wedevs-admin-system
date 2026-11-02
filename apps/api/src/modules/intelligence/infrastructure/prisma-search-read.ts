import { Injectable } from '@nestjs/common';
import type {
  SearchCriteria,
  SearchHit,
  SearchRankedResult,
  SearchReadPort,
} from '../application/ports/search-read.port';
import type { SearchableEntityType } from '../domain/search-query';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import {
  TransactionHost,
  type DbClient,
} from '../../../shared/infrastructure/prisma/transaction-host';

/**
 * A short query inside a long title scores far below 0.3 on `similarity`; `word_similarity` compares it
 * with the best extent of the title, as the mock does word by word (A10).
 */
export const WORD_SIMILARITY_THRESHOLD = 0.3;

interface HitRow {
  entityType: SearchableEntityType;
  entityId: string;
  code: string | null;
  title: string;
  subtitle: string | null;
  status: string | null;
  archived: boolean;
}

interface RankedRow extends HitRow {
  total: number;
}

/** Postgres text cannot hold NUL, and the index strips it from what it stores, so the text loses it too. */
const cleaned = (criteria: SearchCriteria): SearchCriteria => ({
  ...criteria,
  text: criteria.text.replaceAll('\u0000', ''),
});

const toHit = (row: HitRow): SearchHit => ({
  entityType: row.entityType,
  entityId: row.entityId,
  code: row.code,
  title: row.title,
  subtitle: row.subtitle,
  status: row.status,
  archived: row.archived,
});

const COLUMNS = Prisma.raw(
  `e."entityType"::text AS "entityType", e."entityId", e."code", e."title", e."subtitle", e."status", e."archived"`,
);

/**
 * Global search over `SearchEntry` (data-rules §7). Matching is the `es_unaccent` `tsvector` (prefix on each
 * lexeme the database's own parser finds in the text, so accents and case are ignored and a code like
 * `PRY-0042` splits exactly as it was indexed) or `word_similarity` of the text against the title served by
 * `search_entry_trgm` through the `<%` operator, with the threshold set for the read only. All user text is
 * a bound parameter; the SQL text is fixed.
 */
@Injectable()
export class PrismaSearchRead implements SearchReadPort {
  constructor(private readonly host: TransactionHost) {}

  async findExact(input: SearchCriteria): Promise<SearchHit | null> {
    const criteria = cleaned(input);
    const rows = await this.host.db.$queryRaw<HitRow[]>(Prisma.sql`
      SELECT ${COLUMNS}
      FROM "SearchEntry" e
      WHERE e."entityType"::text = ANY(${[...criteria.types]}::text[])
        AND (${criteria.includeArchived} OR NOT e."archived")
        AND (upper(e."code") = upper(${criteria.text})
          OR (e."entityType" = 'INVOICE' AND upper(e."title") = upper(${criteria.text})))
      ORDER BY array_position(${[...criteria.types]}::text[], e."entityType"::text), e."entityId"
      LIMIT 1`);
    return rows[0] ? toHit(rows[0]) : null;
  }

  async search(input: SearchCriteria, limit: number): Promise<SearchRankedResult> {
    const criteria = cleaned(input);
    const run = async (db: DbClient): Promise<RankedRow[]> => {
      await db.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(WORD_SIMILARITY_THRESHOLD)}, true)`;
      return db.$queryRaw<RankedRow[]>(Prisma.sql`
        WITH q AS (
          SELECT to_tsquery('es_unaccent', string_agg(quote_literal(l) || ':*', ' & ')) AS ts
          FROM unnest(tsvector_to_array(to_tsvector('es_unaccent', ${criteria.text}::text))) AS l
        ),
        hits AS (
          SELECT ${COLUMNS},
            (CASE WHEN e."search" @@ q.ts THEN 1 + ts_rank(e."search", q.ts) ELSE 0 END)
              + word_similarity(${criteria.text}, e."title") AS score
          FROM "SearchEntry" e, q
          WHERE e."entityType"::text = ANY(${[...criteria.types]}::text[])
            AND (${criteria.includeArchived} OR NOT e."archived")
            AND (e."search" @@ q.ts OR ${criteria.text}::text <% e."title")
        ),
        ranked AS (
          SELECT hits.*,
            count(*) OVER (PARTITION BY "entityType")::int AS "total",
            row_number() OVER (ORDER BY score DESC, "title", "entityId") AS rn
          FROM hits
        )
        SELECT "entityType", "entityId", "code", "title", "subtitle", "status", "archived", "total"
        FROM ranked WHERE rn <= ${limit} ORDER BY rn`);
    };
    // The threshold is local to a transaction, so a read outside one opens its own.
    const rows = this.host.inTransaction
      ? await run(this.host.db)
      : await this.host.base.$transaction((tx) => run(tx as DbClient));

    const totals: Partial<Record<SearchableEntityType, number>> = {};
    for (const row of rows) totals[row.entityType] = row.total;
    return { hits: rows.map(toHit), totals };
  }
}
