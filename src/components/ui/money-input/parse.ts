import { Money, toDecimal, type MoneyString } from "@/lib/money";

/**
 * Locale-aware decimal typing for money and rate fields (C15). The user types in the display locale
 * ("1.234,56" in ES, "1,234.56" in EN); the field value is always the canonical plain decimal string
 * ("1234.56"). Nothing here converts money to a JS number: rounding goes through decimal.js.
 */

export interface DecimalSeparators {
  decimal: string;
  group: string;
}

export function getSeparators(locale: string): DecimalSeparators {
  // 1,000,000.5 has grouping digits in every locale (`es` skips grouping below 10,000).
  const parts = new Intl.NumberFormat(locale).formatToParts(1_000_000.5);
  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

export interface ParseDecimalOptions {
  /** Result is rounded half up to this many decimals (2 for amounts, 8 for rates). */
  maxDecimals: number;
  allowNegative?: boolean;
}

const IGNORED_SPACING = /[\s  ']/g;

function groupsAreValid(integerPart: string, group: string): boolean {
  const pieces = integerPart.split(group);
  return pieces.every((piece, index) => (index === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(piece));
}

/** Rounds half up and prints without exponent or trailing zeros; "-0" becomes "0". */
export function canonicalDecimal(value: MoneyString, maxDecimals: number): MoneyString {
  const rounded = toDecimal(value).toDecimalPlaces(maxDecimals, Money.ROUND_HALF_UP);
  return rounded.isZero() ? "0" : rounded.toString();
}

/**
 * Normalizes what the user typed to the canonical decimal string, or `null` when it cannot be read as a
 * number. Blank input yields `""`. A lone separator that is not the locale's decimal mark is read as a
 * group mark only when exactly three digits follow it ("1.234" in ES is 1234, "755.16" is 755.16).
 */
export function parseLocalizedDecimal(
  input: string,
  locale: string,
  options: ParseDecimalOptions,
): MoneyString | null {
  let text = input.replace(IGNORED_SPACING, "");
  if (text === "") return "";

  let negative = false;
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = true;
    text = text.slice(1);
  }
  if (text === "" || !/^[\d.,]+$/.test(text)) return null;
  if (negative && !options.allowNegative) return null;

  const { decimal: localeDecimal } = getSeparators(locale);
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  let decimalMark: string | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalMark = lastDot > lastComma ? "." : ",";
  } else {
    const only = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (only !== null) {
      const occurrences = text.split(only).length - 1;
      if (only === localeDecimal) {
        if (occurrences > 1) return null;
        decimalMark = only;
      } else if (occurrences === 1 && !/^\d{1,3}[.,]\d{3}$/.test(text)) {
        decimalMark = only;
      }
    }
  }

  let integerPart = text;
  let fraction = "";
  if (decimalMark !== null) {
    const at = text.lastIndexOf(decimalMark);
    integerPart = text.slice(0, at);
    fraction = text.slice(at + 1);
  }
  const groupMark = decimalMark === "." ? "," : decimalMark === "," ? "." : null;
  if (groupMark !== null) {
    if (integerPart.includes(decimalMark ?? "")) return null;
    if (integerPart.includes(groupMark) && !groupsAreValid(integerPart, groupMark)) return null;
    integerPart = integerPart.split(groupMark).join("");
  } else if (/[.,]/.test(integerPart)) {
    const mark = integerPart.includes(".") ? "." : ",";
    if (!groupsAreValid(integerPart, mark) || /[.,]/.test(integerPart.split(mark).join(""))) {
      return null;
    }
    integerPart = integerPart.split(mark).join("");
  }
  if (/[.,]/.test(fraction)) return null;

  const normalized = `${integerPart.replace(/^0+(?=\d)/, "") || "0"}${fraction ? `.${fraction}` : ""}`;
  const canonical = canonicalDecimal(normalized, options.maxDecimals);
  return negative && canonical !== "0" ? `-${canonical}` : canonical;
}

export interface FormatDecimalOptions {
  minFractionDigits: number;
  maxFractionDigits: number;
}

/** Display text for a canonical decimal string, formatted by Intl over the string (never a number). */
export function formatDecimalForInput(
  value: MoneyString,
  locale: string,
  options: FormatDecimalOptions,
): string {
  if (value === "") return "";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: options.minFractionDigits,
    maximumFractionDigits: options.maxFractionDigits,
    useGrouping: true,
  }).format(value as `${number}`);
}
