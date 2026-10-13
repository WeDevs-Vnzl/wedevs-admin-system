"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

export const SEARCH_DEBOUNCE_MS = 300;

interface DataTableSearchProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
}

/** Text search with a local draft; the URL is written after the user stops typing for 300 ms. */
export function DataTableSearch({ value, onChange, placeholder }: DataTableSearchProps) {
  const t = useTranslations("table");
  const committed = value ?? "";
  const [draft, setDraft] = useState(committed);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // External resets (e.g. "Limpiar") replace the draft: adjust during render, not in an effect.
  const [seenCommitted, setSeenCommitted] = useState(committed);
  if (seenCommitted !== committed) {
    setSeenCommitted(committed);
    setDraft(committed);
  }

  useEffect(() => {
    if (draft === committed) return;
    const timer = setTimeout(() => onChangeRef.current(draft.trim() || undefined), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, committed]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder ?? t("search.placeholder")}
        aria-label={t("search.label")}
        className="pl-8"
      />
    </div>
  );
}
