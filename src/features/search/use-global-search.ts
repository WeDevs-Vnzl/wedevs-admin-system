"use client";

import { useEffect, useState } from "react";
import { parseSearchQuery, type SearchResultsDTO } from "@/lib/validators/search";
import { searchGlobalAction } from "./actions";

/** Pause after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 150;

export type GlobalSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; results: SearchResultsDTO };

type Settled = { query: string } & (
  { status: "error" } | { status: "ready"; results: SearchResultsDTO }
);

/**
 * Debounced `searchGlobal` for what the user typed (prefix included). A query whose text is empty after
 * the prefix (`""`, `c:`) does not search. Only the answer to the current query is shown, so a slow
 * earlier response never replaces a newer one.
 */
export function useGlobalSearch(query: string): GlobalSearchState {
  const q = query.trim();
  const searchable = parseSearchQuery(q).text !== "";
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await searchGlobalAction({ q });
      if (cancelled) return;
      setSettled(
        result.ok
          ? { query: q, status: "ready", results: result.data }
          : { query: q, status: "error" },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, searchable]);

  if (!searchable) return { status: "idle" };
  if (settled?.query !== q) return { status: "loading" };
  return settled.status === "ready"
    ? { status: "ready", results: settled.results }
    : { status: "error" };
}
