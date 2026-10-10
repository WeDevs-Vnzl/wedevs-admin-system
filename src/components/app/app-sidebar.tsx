"use client";

import { PanelLeft, PanelLeftClose, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { isNavItemVisible, SETTINGS_NAV_ITEM, visibleNavGroups, type NavItem } from "@/config/nav";
import type { SessionUser } from "@/server/auth/types";

/** Whether `href` is the current route or one of its sub-routes. */
function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Sidebar of the (app) layout (frontend-patterns §2, wireframe 4.2): collapsible to icons on desktop, a
// sheet on mobile (the registry handles both). Visibility comes from `can()` through `nav.ts` (cosmetic, C13).
export function AppSidebar({ user }: { user: SessionUser }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("shell.sidebar");
  const pathname = usePathname();
  const groups = visibleNavGroups(user);
  const showSettings = isNavItemVisible(SETTINGS_NAV_ITEM, user);

  function renderItem(item: NavItem) {
    const label = t(`items.${item.key}`);
    const active = isActivePath(pathname, item.href);
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton asChild isActive={active} tooltip={label}>
          <Link href={item.href} aria-current={active ? "page" : undefined}>
            <item.icon aria-hidden />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <BrandMark />
          <span className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {tCommon("app.name")}
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={tShell("label")} className="flex flex-col gap-1">
          {groups.map((group) => (
            <SidebarGroup key={group.key ?? "root"}>
              {group.key ? <SidebarGroupLabel>{t(`groups.${group.key}`)}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      {showSettings ? (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActivePath(pathname, SETTINGS_NAV_ITEM.href)}
                tooltip={t(`items.${SETTINGS_NAV_ITEM.key}`)}
              >
                <Link href={SETTINGS_NAV_ITEM.href}>
                  <Settings aria-hidden />
                  <span>{t(`items.${SETTINGS_NAV_ITEM.key}`)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}

// Expands and collapses the sidebar (desktop icon mode) or opens the mobile sheet. The registry's own
// trigger carries an English sr-only label, so the shell uses this button with translated labels.
export function SidebarToggle() {
  const t = useTranslations("shell.sidebar");
  const { state, isMobile, openMobile, toggleSidebar } = useSidebar();
  const open = isMobile ? openMobile : state === "expanded";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={open ? t("collapse") : t("expand")}
      aria-expanded={open}
    >
      {open ? <PanelLeftClose aria-hidden /> : <PanelLeft aria-hidden />}
    </Button>
  );
}
