"use client";

import { useEffect, useState } from "react";
import { useApiClient } from "@/lib/api/client";
import type { SearchResultsDto } from "@/lib/api/types/search";
import { parseSearchQuery } from "@/lib/validators/search";
import { searchGlobalRecords } from "./search-api";

/** Pause after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 150;

export type GlobalSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; results: SearchResultsDto };

type Settled = { query: string } & (
  { status: "error" } | { status: "ready"; results: SearchResultsDto }
);

/**
 * Debounced `GET /api/v1/search` for what the user typed (prefix included), through the browser client. A
 * query whose text is empty after the prefix (`""`, `c:`) does not search. Only the answer to the current
 * query is shown, so a slow earlier response never replaces a newer one.
 */
export function useGlobalSearch(query: string): GlobalSearchState {
  const api = useApiClient();
  const q = query.trim();
  const searchable = parseSearchQuery(q).text !== "";
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await searchGlobalRecords(api, { q });
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
  }, [api, q, searchable]);

  if (!searchable) return { status: "idle" };
  if (settled?.query !== q) return { status: "loading" };
  return settled.status === "ready"
    ? { status: "ready", results: settled.results }
    : { status: "error" };
}
