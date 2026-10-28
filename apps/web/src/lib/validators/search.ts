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

/**
 * `searchGlobal(q, filters)`. `q` is what the user typed, prefix included (the service applies
 * `parseSearchQuery`); `entityTypes` narrows explicitly (the prefix wins when both are set).
 * Archived rows appear only for Owner/Admin with `includeArchived`.
 */
export const searchGlobalInputSchema = z.object({
  q: z.string().trim().min(1).max(200),
  entityTypes: z.array(searchableEntityTypeSchema).min(1).max(9).optional(),
  includeArchived: z.boolean().default(false),
  /** Maximum results in total (the UI groups them by type). */
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
});
export type SearchGlobalInput = z.infer<typeof searchGlobalInputSchema>;
export type SearchGlobalFormValues = z.input<typeof searchGlobalInputSchema>;

/** `reindexEntity(type, id)`: internal, called by services in their transaction. */
export const reindexEntityInputSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: idSchema,
});
export type ReindexEntityInput = z.infer<typeof reindexEntityInputSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** One hit: icon by type, code, title, subtitle and status (PRD §7.6). */
export const searchResultSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: idSchema,
  code: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Raw status value of the entity (an enum of its module); the UI translates it by `entityType`. */
  status: z.string().nullable(),
  archived: z.boolean(),
});
export type SearchResultDTO = z.infer<typeof searchResultSchema>;

export const searchGroupSchema = z.object({
  entityType: searchableEntityTypeSchema,
  /** Matches of this type before the cap. */
  total: z.number().int().nonnegative(),
  items: z.array(searchResultSchema),
});
export type SearchGroupDTO = z.infer<typeof searchGroupSchema>;

/** Output of `searchGlobal`: groups in a stable type order, empty groups omitted. */
export const searchResultsSchema = z.object({
  /** The text actually searched (prefix removed). */
  query: z.string(),
  /** Type forced by the prefix, if any. */
  entityType: searchableEntityTypeSchema.nullable(),
  groups: z.array(searchGroupSchema),
});
export type SearchResultsDTO = z.infer<typeof searchResultsSchema>;

/** Output of `reindexEntity`. */
export const reindexEntityResultSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: idSchema,
  /** `false` when the entity no longer exists or is not indexable. */
  indexed: z.boolean(),
});
export type ReindexEntityResultDTO = z.infer<typeof reindexEntityResultSchema>;

// ───────────────────────────── Services (PRD §12 `search`) ─────────────────────────────

/**
 * `search` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11). `searchGlobal` is also
 * a read action and follows the action sequence (C10); `reindexEntity` is internal.
 */
export type SearchService<Ctx = unknown> = {
  searchGlobal: (ctx: Ctx, input: SearchGlobalInput) => Promise<SearchResultsDTO>;
  reindexEntity: (ctx: Ctx, input: ReindexEntityInput) => Promise<ReindexEntityResultDTO>;
};
