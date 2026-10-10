// Framework-free on purpose: scripts/check-i18n.ts imports this file, so it must not pull in next-intl or next.
export const locales = ["es", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "es";

export const localeCookieName = "NEXT_LOCALE";

export const timeZone = "America/Caracas";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
