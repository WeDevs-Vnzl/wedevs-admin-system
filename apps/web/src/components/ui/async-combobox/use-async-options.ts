"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { AsyncComboboxOption } from "./types";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface Loaded {
  query: string;
  options: AsyncComboboxOption[];
}

/**
 * Debounced option loading. The list is fetched while the popup is open, for the debounced query (the
 * empty query first). Stale responses are dropped; a failed load shows an empty list.
 */
export function useAsyncOptions(
  loadOptions: (query: string) => Promise<readonly AsyncComboboxOption[]>,
  debounceMs: number,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const debounced = useDebouncedValue(query, debounceMs);
  const load = useEffectEvent((q: string) => loadOptions(q));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    load(debounced).then(
      (options) => {
        if (!cancelled) setLoaded({ query: debounced, options: [...options] });
      },
      () => {
        if (!cancelled) setLoaded({ query: debounced, options: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  return {
    open,
    setOpen,
    query,
    setQuery,
    options: loaded?.options ?? [],
    loading: open && (loaded?.query !== debounced || debounced !== query),
  };
}
