// MOCK — global search of Hito 1 (PRD §7.6, HU-26; data-rules §7). `fn(ctx, input)`, framework-free
// (C11). There is no `SearchEntry` table here: the index is built live from the store on every call, one
// entry per searchable record, so `reindexEntity` only reports whether the record is indexable. Replaced by
// `src/server/services/search.service.ts` over `SearchEntry` + `pg_trgm` in Hito 2 (C9).
//
// Matching, after `parseSearchQuery` (the prefix wins over `entityTypes`) and accent folding (`foldText`):
//   exact code   the text equals a record's code (`FAC-0012`, any case) or an invoice's fiscal number: that
//                record alone is returned, so the palette goes straight to it (HU-26 CA3).
//   substring    a folded field contains the text (a field starting with it ranks first).
//   trigrams     every word of the text is similar to some word of a field: pg_trgm similarity (padded
//                trigrams, |A ∩ B| ÷ |A ∪ B|) ≥ 0.3, its default threshold ("invsion" → "Inversión").
// Hits are ranked by score, then title; `limit` caps the hits in total and each group keeps its `total`.
// Visibility: a type needs `read` on its resource (financial types: Owner/Admin); archived records only
// with `includeArchived` and the trash grant (HU-28 CA1).
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  parseSearchQuery,
  type ReindexEntityInput,
  type ReindexEntityResultDTO,
  type SearchGlobalInput,
  type SearchGroupDTO,
  type SearchResultDTO,
  type SearchResultsDTO,
  type SearchableEntityType,
} from "@/lib/validators/search";
import { can, type PermissionResource } from "@/server/auth/permissions";
import type { MockServiceContext } from "../ctx";
import { resolveEntityRef, richTextToPlainText } from "../entity-refs";
import type { MockStore } from "../store";
import { foldText } from "./list";

const TRIGRAM_THRESHOLD = 0.3;

const RESOURCE: Record<SearchableEntityType, PermissionResource> = {
  CLIENT: "client",
  CONTACT: "contact",
  PROJECT: "project",
  INVOICE: "invoice",
  PAYMENT: "payment",
  EXPENSE: "expense",
  ACCOUNT: "account",
  DOCUMENT: "document",
  NOTE: "note",
};

/** One index entry: the hit it becomes, the texts it is matched against and its exact-hit keys. */
interface Entry {
  hit: SearchResultDTO;
  texts: (string | null | undefined)[];
  /** Texts that resolve to this record alone when typed in full (its code by default). */
  keys: string[];
}

const entry = (
  entityType: SearchableEntityType,
  entityId: string,
  fields: Omit<SearchResultDTO, "entityType" | "entityId">,
  texts: (string | null | undefined)[],
  keys: (string | null)[] = [fields.code],
): Entry => ({
  hit: { entityType, entityId, ...fields },
  texts,
  keys: keys.filter((key): key is string => Boolean(key)),
});

function clientName(db: MockStore, id: string | undefined): string | null {
  return db.clients.find((row) => row.id === id)?.tradeName ?? null;
}

/** The index entries of one type, archived ones included. */
function entriesOf(db: MockStore, type: SearchableEntityType): Entry[] {
  switch (type) {
    case "CLIENT":
      return db.clients.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.tradeName,
            subtitle: row.legalName !== row.tradeName ? row.legalName : null,
            status: row.status,
            archived: row.archivedAt !== null,
          },
          [row.code, row.tradeName, row.legalName, row.taxId, row.email],
        ),
      );
    case "CONTACT":
      return db.contacts.map((row) =>
        entry(
          type,
          row.id,
          {
            code: null,
            title: row.fullName,
            subtitle: clientName(db, row.clientId),
            status: null,
            archived: row.archivedAt !== null,
          },
          [row.fullName, row.email, row.position],
        ),
      );
    case "PROJECT":
      return db.projects.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.name,
            subtitle: row.clients.map((link) => clientName(db, link.clientId)).join(", ") || null,
            status: row.status,
            archived: row.archivedAt !== null,
          },
          [row.code, row.name, row.summary],
        ),
      );
    case "INVOICE":
      return db.invoices.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.invoiceNumber,
            subtitle: row.client.label,
            status: row.status,
            archived: row.archivedAt !== null,
          },
          [row.code, row.invoiceNumber, row.controlNumber, row.client.label],
          [row.code, row.invoiceNumber],
        ),
      );
    case "PAYMENT":
      return db.payments.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.client.label,
            subtitle: row.reference ?? row.method.name,
            status: row.status,
            archived: false,
          },
          [row.code, row.reference, row.client.label],
        ),
      );
    case "EXPENSE":
      return db.expenses.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.description,
            subtitle: row.vendor,
            status: row.status,
            archived: false,
          },
          [row.code, row.description, row.vendor],
        ),
      );
    case "ACCOUNT":
      return db.accounts.map((row) =>
        entry(
          type,
          row.id,
          { code: null, title: row.name, subtitle: row.institution, status: null, archived: false },
          [row.name, row.institution, row.holderName],
        ),
      );
    case "DOCUMENT":
      return db.documents.map((row) =>
        entry(
          type,
          row.id,
          {
            code: row.code,
            title: row.title,
            subtitle: db.documentTypes.find((item) => item.id === row.typeId)?.name ?? null,
            status: row.status,
            archived: row.archivedAt !== null,
          },
          [row.code, row.title],
        ),
      );
    case "NOTE":
      return db.notes.map((row) =>
        entry(
          type,
          row.id,
          {
            code: null,
            title: resolveEntityRef(db, "NOTE", row.id)?.label ?? row.id,
            subtitle: null,
            status: null,
            archived: row.archivedAt !== null,
          },
          [row.title, richTextToPlainText(row.content)],
        ),
      );
  }
}

// ───────────────────────────── Matching ─────────────────────────────

const words = (value: string) => value.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);

/** pg_trgm trigrams of one word: padded with two spaces before and one after. */
function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** 0 when `needle` does not match; higher is better. */
function score(needle: string, texts: Entry["texts"]): number {
  const folded = texts.filter((text): text is string => !!text).map(foldText);
  if (folded.some((text) => text.startsWith(needle))) return 1;
  if (folded.some((text) => text.includes(needle))) return 0.8;
  const hay = folded.flatMap(words);
  const best = words(needle).map((word) =>
    hay.reduce((max, candidate) => Math.max(max, similarity(word, candidate)), 0),
  );
  if (best.length === 0 || best.some((value) => value < TRIGRAM_THRESHOLD)) return 0;
  return 0.5 * Math.min(...best);
}

// ───────────────────────────── Services ─────────────────────────────

function visibleTypes(
  ctx: MockServiceContext,
  input: SearchGlobalInput,
  forced?: SearchableEntityType,
) {
  const wanted = forced ? [forced] : (input.entityTypes ?? SEARCHABLE_ENTITY_TYPE_VALUES);
  return SEARCHABLE_ENTITY_TYPE_VALUES.filter(
    (type) => wanted.includes(type) && can(ctx.user, "read", RESOURCE[type]),
  );
}

export async function searchGlobal(
  ctx: MockServiceContext,
  input: SearchGlobalInput,
): Promise<SearchResultsDTO> {
  const parsed = parseSearchQuery(input.q);
  const needle = foldText(parsed.text);
  const result: SearchResultsDTO = {
    query: parsed.text,
    entityType: parsed.entityType ?? null,
    groups: [],
  };
  if (!needle) return result;

  const withArchived = input.includeArchived && can(ctx.user, "restore", "trash");
  const types = visibleTypes(ctx, input, parsed.entityType);
  const candidates = types
    .flatMap((type) => entriesOf(ctx.db, type))
    .filter((item) => withArchived || !item.hit.archived);

  const exact = candidates.find((item) => item.keys.some((key) => foldText(key) === needle));
  if (exact) {
    result.groups = [{ entityType: exact.hit.entityType, total: 1, items: [exact.hit] }];
    return result;
  }

  const matches = candidates
    .map((item) => ({ hit: item.hit, score: score(needle, item.texts) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title, "es"));
  const shown = new Set(matches.slice(0, input.limit).map((item) => item.hit));
  result.groups = types
    .map((type): SearchGroupDTO => {
      const ofType = matches.filter((item) => item.hit.entityType === type);
      return {
        entityType: type,
        total: ofType.length,
        items: ofType.filter((item) => shown.has(item.hit)).map((item) => item.hit),
      };
    })
    .filter((group) => group.items.length > 0);
  return result;
}

/** No index to maintain in Hito 1: reports whether the record exists, so Hito 2 can index it. */
export async function reindexEntity(
  ctx: MockServiceContext,
  input: ReindexEntityInput,
): Promise<ReindexEntityResultDTO> {
  const indexed = entriesOf(ctx.db, input.entityType).some(
    (item) => item.hit.entityId === input.entityId,
  );
  return { entityType: input.entityType, entityId: input.entityId, indexed };
}
