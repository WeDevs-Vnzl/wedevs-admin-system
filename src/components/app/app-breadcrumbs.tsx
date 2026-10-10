"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { findNavItem, SETTINGS_NAV_ITEM } from "@/config/nav";
import { findSettingsSection } from "@/config/settings-nav";

interface Crumb {
  label: string;
  href: string;
}

// Breadcrumbs of the topbar, derived from the route and the nav entry it belongs to (`nav.ts`). Segments
// with a translated label under `nav.segments` use it; ids and unknown segments show as they appear in the URL.
export function AppBreadcrumbs() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");
  const tShell = useTranslations("shell.breadcrumbs");
  const pathname = usePathname();

  const item = findNavItem(pathname);
  const crumbs: Crumb[] = [{ label: tCommon("app.name"), href: "/dashboard" }];
  if (item) crumbs.push({ label: t(`items.${item.key}`), href: item.href });

  const rest = item ? pathname.slice(item.href.length) : pathname;
  const segments = rest.split("/").filter(Boolean);
  // Under /settings the first segment is a section slug, labelled from `settings.nav` (m1).
  const section =
    item?.key === SETTINGS_NAV_ITEM.key ? findSettingsSection(segments[0] ?? "") : undefined;
  let href = item?.href ?? "";
  for (const [index, segment] of segments.entries()) {
    href = `${href}/${segment}`;
    if (index === 0 && section) {
      crumbs.push({ label: tSettings(`nav.${section.labelKey}`), href });
      continue;
    }
    const label = t.has(`segments.${segment}`) ? t(`segments.${segment}`) : segment;
    crumbs.push({ label, href });
  }

  const last = crumbs.length - 1;
  return (
    <Breadcrumb aria-label={tShell("label")} className="min-w-0 truncate">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.href}-${index}`}>
            <BreadcrumbItem className="min-w-0">
              {index === last ? (
                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild className="truncate">
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {/* A sibling of the item, not a child: an <li> inside an <li> is invalid HTML, the parser closes the
                outer one and React reports a hydration mismatch (#418). */}
            {index === last ? null : <BreadcrumbSeparator />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
