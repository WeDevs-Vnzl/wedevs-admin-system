"use client";

import { useState } from "react";
import type { MoneyString } from "@/lib/money";
import { formatDecimalForInput, parseLocalizedDecimal, type FormatDecimalOptions } from "./parse";

interface UseDecimalTextOptions extends FormatDecimalOptions {
  /** Canonical decimal string held by the form (`""` when empty). */
  value: MoneyString;
  onValueChange: (value: MoneyString) => void;
  locale: string;
  maxDecimals: number;
  allowNegative?: boolean;
}

/**
 * Keeps the text the user is typing (locale formatted) next to the canonical value the form holds. The
 * text is the source while typing; the canonical string is emitted on every keystroke (`""` when the
 * text is blank or unreadable) and the text is re-formatted on blur and when the value changes from
 * outside (prefill, reset).
 */
export function useDecimalText({
  value,
  onValueChange,
  locale,
  maxDecimals,
  allowNegative,
  minFractionDigits,
  maxFractionDigits,
}: UseDecimalTextOptions) {
  const parse = (text: string) => parseLocalizedDecimal(text, locale, { maxDecimals, allowNegative });
  const format = (canonical: MoneyString) =>
    formatDecimalForInput(canonical, locale, { minFractionDigits, maxFractionDigits });

  const [text, setText] = useState(() => format(value));
  const [seenValue, setSeenValue] = useState(value);

  if (value !== seenValue) {
    setSeenValue(value);
    const parsed = parse(text);
    // Unreadable text emitted "" before; keep it on screen so the user can fix it.
    if (parsed !== value && !(parsed === null && value === "")) setText(format(value));
  }

  const parsed = parse(text);

  return {
    text,
    invalid: text.trim() !== "" && parsed === null,
    onTextChange(next: string) {
      setText(next);
      onValueChange(parse(next) ?? "");
    },
    onBlur() {
      if (parsed !== null && parsed !== "") setText(format(parsed));
    },
  };
}
