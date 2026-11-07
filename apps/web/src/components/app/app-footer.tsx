import { getTranslations } from "next-intl/server";

/** Shown in the footer; bumped with the release, not per request. */
export const APP_VERSION = "1.0";

// Footer of the (app) shell (frontend-patterns §2, wireframe 4.2). No backup pill: the daily backup is not
// in the Hito 1 scope (DT-48).
export async function AppFooter() {
  const t = await getTranslations("shell.footer");

  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground md:px-6">
      <span>{t("copyright", { year: new Date().getFullYear() })}</span>
      <div className="flex min-h-5 items-center gap-2">
        <span>{t("version", { version: APP_VERSION })}</span>
      </div>
    </footer>
  );
}
