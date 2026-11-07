"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { localeCookieName, type Locale } from "@/i18n/config";
import type { Theme } from "@/lib/validators/preferences";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;
const SYNCED_KEY = "wedevs:preference-sync";

function readLocaleCookie(): string | undefined {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${localeCookieName}=`));
  return entry?.slice(localeCookieName.length + 1);
}

/**
 * Applies the user's stored locale and theme once per browser session (HU-30: a new session, possibly on
 * another device, starts with the saved choice). It writes the `NEXT_LOCALE` cookie (refreshing the request
 * only if the cookie changed) and sets the theme through next-themes, whose provider disables CSS
 * transitions while the class switches. Later changes go through the locale switcher and the theme toggle,
 * which save the preference themselves. Renders nothing.
 */
export function PreferenceSync({ locale, theme }: { locale: Locale; theme: Theme }) {
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SYNCED_KEY)) return;
      sessionStorage.setItem(SYNCED_KEY, "1");
    } catch {
      // Storage blocked: sync on every mount rather than never.
    }
    setTheme(theme);
    if (readLocaleCookie() !== locale) {
      document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax`;
      router.refresh();
    }
    // Once per session: the stored values at the first render are the ones to apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
