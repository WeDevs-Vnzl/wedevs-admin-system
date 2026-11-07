import "server-only";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, localeCookieName, timeZone, type Locale } from "./config";
import { getServerApi } from "@/lib/api/server";
import { getSessionUser } from "@/lib/auth/session";
import { namespaces, type Namespace } from "./namespaces";

// Default formats for every request (DT-31). Components format with the names below, e.g. t.number(value, "decimal").
// Money is never formatted here: use formatMoney from @/lib/money, which takes the row's currency (C15).
const formats = {
  dateTime: {
    short: { day: "2-digit", month: "2-digit", year: "numeric" },
    medium: { day: "numeric", month: "short", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
  },
  number: {
    decimal: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  },
} as const;

async function loadNamespace(locale: Locale, namespace: Namespace) {
  const catalog = await import(`./messages/${locale}/${namespace}.json`);
  return catalog.default as Record<string, unknown>;
}

// Messages are keyed by namespace: useTranslations("shell") reads messages.shell.
async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    namespaces.map(
      async (namespace) => [namespace, await loadNamespace(locale, namespace)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * The signed-in user's stored locale (HU-30), read through the API client. Signed out: no BE call. Preferences
 * are cosmetic, so any failure (no Clerk context, BE down, unknown value) reads as "no stored locale".
 */
async function storedLocale(): Promise<Locale | undefined> {
  try {
    // The session seam (C26) answers "signed out" without a BE call; `/me` is memoized for the layout.
    if (!(await getSessionUser())) return undefined;
    const api = await getServerApi();
    const { data } = await api.GET("/api/v1/me/preferences");
    return isLocale(data?.locale) ? data.locale : undefined;
  } catch {
    return undefined;
  }
}

// Locale order (frontend-patterns §15): the NEXT_LOCALE cookie, then the stored UserPreference, then `es`.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(localeCookieName)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : ((await storedLocale()) ?? defaultLocale);

  return {
    locale,
    timeZone,
    formats,
    messages: await loadMessages(locale),
  };
});
