"use client";

import { useTranslations } from "next-intl";
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
import { findNavItem } from "@/config/nav";

interface Crumb {
  label: string;
  href: string;
}

// Breadcrumbs of the topbar, derived from the route and the nav entry it belongs to (`nav.ts`). Segments
// with a translated label under `nav.segments` use it; ids and unknown segments show as they appear in the URL.
export function AppBreadcrumbs() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("shell.breadcrumbs");
  const pathname = usePathname();

  const item = findNavItem(pathname);
  const crumbs: Crumb[] = [{ label: tCommon("app.name"), href: "/dashboard" }];
  if (item) crumbs.push({ label: t(`items.${item.key}`), href: item.href });

  const rest = item ? pathname.slice(item.href.length) : pathname;
  const segments = rest.split("/").filter(Boolean);
  let href = item?.href ?? "";
  for (const segment of segments) {
    href = `${href}/${segment}`;
    const label = t.has(`segments.${segment}`) ? t(`segments.${segment}`) : segment;
    crumbs.push({ label, href });
  }

  const last = crumbs.length - 1;
  return (
    <Breadcrumb aria-label={tShell("label")} className="min-w-0 truncate">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <BreadcrumbItem key={`${crumb.href}-${index}`} className="min-w-0">
            {index === last ? (
              <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
            ) : (
              <>
                <BreadcrumbLink asChild className="truncate">
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
                <BreadcrumbSeparator />
              </>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
