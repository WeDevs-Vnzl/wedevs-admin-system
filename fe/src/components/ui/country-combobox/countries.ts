import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export type { CountryCode };

export interface CountryEntry {
  /** ISO 3166-1 alpha-2. */
  code: CountryCode;
  /** Name in the display locale (from `Intl.DisplayNames`). */
  name: string;
  /** Calling code without `+`, e.g. "58". */
  dialCode: string;
  /** Flag emoji. */
  flag: string;
}

const cache = new Map<string, CountryEntry[]>();

/** Countries sorted by localized name. Names come from `Intl`, never from a hand-kept table. */
export function listCountries(locale: string): CountryEntry[] {
  const cached = cache.get(locale);
  if (cached) return cached;
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const entries = getCountries().map((code) => ({
    code,
    name: names.of(code) ?? code,
    dialCode: getCountryCallingCode(code),
    flag: getUnicodeFlagIcon(code),
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name, locale));
  cache.set(locale, entries);
  return entries;
}

export function isCountryCode(value: string): value is CountryCode {
  return getCountries().includes(value as CountryCode);
}
