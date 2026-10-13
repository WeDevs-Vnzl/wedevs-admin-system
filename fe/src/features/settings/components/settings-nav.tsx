"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { findSettingsSection } from "@/config/settings-nav";
import { cn } from "@/lib/utils";

type SettingsNavProps = {
  // Visible section slugs in §8.15 order (the server filters them with can()).
  slugs: readonly string[];
};

// Section navigation of the settings frame. Slugs only cross the server/client boundary; labels and icons
// are resolved here from `src/config/settings-nav.ts`.
export function SettingsNav({ slugs }: SettingsNavProps) {
  const t = useTranslations("settings");
  const pathname = usePathname();

  return (
    <nav aria-label={t("nav.label")} className="md:sticky md:top-20 md:self-start">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {slugs.map((slug) => {
          const section = findSettingsSection(slug);
          if (!section) return null;
          const href = `/settings/${slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = section.icon;
          return (
            <li key={slug} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(`nav.${section.labelKey}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
