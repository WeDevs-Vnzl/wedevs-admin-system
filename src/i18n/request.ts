import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, localeCookieName, timeZone, type Locale } from "./config";
import { namespaces, type Namespace } from "./namespaces";

// Default formats for every request (DT-31). Components format with the names below, e.g. t.number(value, "currency").
const formats = {
  dateTime: {
    short: { day: "2-digit", month: "2-digit", year: "numeric" },
    medium: { day: "numeric", month: "short", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
  },
  number: {
    currency: { style: "currency", currency: "USD" },
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

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(localeCookieName)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : defaultLocale;

  return {
    locale,
    timeZone,
    formats,
    messages: await loadMessages(locale),
  };
});
