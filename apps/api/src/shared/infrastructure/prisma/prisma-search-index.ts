import { Injectable } from '@nestjs/common';
import type { EntityType } from '../../domain/enums';
import type {
  SearchIndexEntry,
  SearchIndexPort,
  SearchTextsUpdate,
} from '../../application/ports/search-index.port';
import { Prisma } from './generated-client';
import { TransactionHost } from './transaction-host';

/** Maximum characters of `SearchEntry.body` (plain text); longer content is cut, never rejected. */
export const SEARCH_BODY_MAX_CHARS = 20_000;

/** Postgres text cannot hold NUL; strips it so an odd pasted character never aborts the mutation. */
const clean = (value: string): string => value.replaceAll('\u0000', '');

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
export function truncateBody(value: string, max: number = SEARCH_BODY_MAX_CHARS): string {
  if (value.length <= max) return value;
  const last = value.charCodeAt(max - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return value.slice(0, isHighSurrogate ? max - 1 : max);
}

/** Rows per `UPDATE … FROM unnest` statement of `setTexts`. */
export const SET_TEXTS_CHUNK = 1_000;

/** Writes `SearchEntry` rows in the current transaction (C12). */
@Injectable()
export class PrismaSearchIndex implements SearchIndexPort {
  constructor(private readonly host: TransactionHost) {}

  async upsert(entry: SearchIndexEntry): Promise<void> {
    const tx = this.host.requireTransaction('SearchIndexPort.upsert');
    const data = {
      code: entry.code === null ? null : clean(entry.code),
      title: clean(entry.title),
      subtitle: entry.subtitle === null ? null : clean(entry.subtitle),
      body: entry.body === null ? null : truncateBody(clean(entry.body)),
      status: entry.status,
      archived: entry.archived,
    };
    await tx.searchEntry.upsert({
      where: { entityType_entityId: { entityType: entry.entityType, entityId: entry.entityId } },
      create: { entityType: entry.entityType, entityId: entry.entityId, ...data },
      update: data,
    });
  }

  async setArchived(entityType: EntityType, entityId: string, archived: boolean): Promise<void> {
    const tx = this.host.requireTransaction('SearchIndexPort.setArchived');
    await tx.searchEntry.updateMany({ where: { entityType, entityId }, data: { archived } });
  }

  async setTexts(entityType: EntityType, rows: readonly SearchTextsUpdate[]): Promise<void> {
    const tx = this.host.requireTransaction('SearchIndexPort.setTexts');
    for (let from = 0; from < rows.length; from += SET_TEXTS_CHUNK) {
      const chunk = rows.slice(from, from + SET_TEXTS_CHUNK);
      const text = (value: string | null | undefined, cap: boolean): string | null =>
        value === undefined || value === null
          ? null
          : cap
            ? truncateBody(clean(value))
            : clean(value);
      const ids = chunk.map((row) => row.entityId);
      const setSubtitle = chunk.map((row) => row.subtitle !== undefined);
      const subtitles = chunk.map((row) => text(row.subtitle, false));
      const setBody = chunk.map((row) => row.body !== undefined);
      const bodies = chunk.map((row) => text(row.body, true));
      await tx.$executeRaw(Prisma.sql`
        UPDATE "SearchEntry" AS s
        SET "subtitle" = CASE WHEN v."setSubtitle" THEN v."subtitle" ELSE s."subtitle" END,
            "body" = CASE WHEN v."setBody" THEN v."body" ELSE s."body" END,
            "updatedAt" = now()
        FROM unnest(${ids}::text[], ${setSubtitle}::boolean[], ${subtitles}::text[], ${setBody}::boolean[], ${bodies}::text[])
          AS v("entityId", "setSubtitle", "subtitle", "setBody", "body")
        WHERE s."entityType" = ${entityType}::"EntityType"
          AND s."entityId" = v."entityId"
          AND ((v."setSubtitle" AND s."subtitle" IS DISTINCT FROM v."subtitle")
            OR (v."setBody" AND s."body" IS DISTINCT FROM v."body"))`);
    }
  }
}
