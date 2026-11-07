import { z } from "./zod";
import { idSchema } from "./common";
import { entityTypeSchema } from "./enums";

/**
 * Global search, Cmd+K (PRD §7.6; data-rules §7). One `SearchEntry` per searchable entity, maintained by
 * `reindexEntity` inside the mutation's transaction (C12). `searchGlobal` matches accent-insensitively
 * with typo tolerance, ranks an exact code match first (HU-26 CA3) and groups results by entity type.
 */

/** Entities in the search index (data-rules §7). */
export const SEARCHABLE_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "ACCOUNT",
  "DOCUMENT",
  "NOTE",
] as const satisfies readonly z.infer<typeof entityTypeSchema>[];
export const searchableEntityTypeSchema = z.enum(SEARCHABLE_ENTITY_TYPE_VALUES);
export type SearchableEntityType = z.infer<typeof searchableEntityTypeSchema>;

// ───────────────────────────── Prefixes ─────────────────────────────

/** `c:` clients · `p:` projects · `f:` invoices · `d:` documents · `n:` notes (PRD §7.6). */
export const SEARCH_PREFIXES = {
  c: "CLIENT",
  p: "PROJECT",
  f: "INVOICE",
  d: "DOCUMENT",
  n: "NOTE",
} as const satisfies Record<string, SearchableEntityType>;

export type SearchPrefix = keyof typeof SEARCH_PREFIXES;

export interface ParsedSearchQuery {
  /** The text to search, without the prefix. */
  text: string;
  /** Entity type forced by the prefix, if any. */
  entityType?: SearchableEntityType;
}

/** Splits a typed query like `c: acme` into the text and the entity type its prefix selects. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const match = /^\s*([a-z]):\s*(.*)$/i.exec(raw);
  const prefix = match?.[1]?.toLowerCase();
  if (match && prefix !== undefined && prefix in SEARCH_PREFIXES) {
    return { text: (match[2] ?? "").trim(), entityType: SEARCH_PREFIXES[prefix as SearchPrefix] };
  }
  return { text: raw.trim() };
}

// ───────────────────────────── Inputs ─────────────────────────────

/** Results per entity type are capped; the footer links to the module's own filtered table. */
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** `reindexEntity(type, id)`: internal, called by services in their transaction. */
export const reindexEntityInputSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: idSchema,
});
// ───────────────────────────── DTOs ─────────────────────────────

/** Output of `reindexEntity`. */
export const reindexEntityResultSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: idSchema,
  /** `false` when the entity no longer exists or is not indexable. */
  indexed: z.boolean(),
});
