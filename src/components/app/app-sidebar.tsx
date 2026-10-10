"use client";

import { LogOut, PanelLeft, PanelLeftClose, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/app/brand-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { SETTINGS_NAV_ITEM, visibleNavGroups, type NavItem } from "@/config/nav";
import type { SessionUser } from "@/server/auth/types";

/** Up to two initials of a name, for the avatar fallback (sidebar user block and topbar menu). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

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
  const tAuth = useTranslations("auth");
  const tUser = useTranslations("shell.userMenu");
  const tRole = useTranslations("enums.UserRole");
  const router = useRouter();
  const pathname = usePathname();
  const groups = visibleNavGroups(user);
  const settingsActive = isActivePath(pathname, SETTINGS_NAV_ITEM.href);

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
        <Link
          href="/dashboard"
          aria-label={tCommon("app.name")}
          className="flex items-center gap-2 px-2 py-1.5"
        >
          <BrandMark />
          <span
            aria-hidden
            className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
          >
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
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={settingsActive}
              tooltip={t(`items.${SETTINGS_NAV_ITEM.key}`)}
            >
              <Link
                href={SETTINGS_NAV_ITEM.href}
                aria-current={settingsActive ? "page" : undefined}
              >
                <Settings aria-hidden />
                <span>{t(`items.${SETTINGS_NAV_ITEM.key}`)}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Wireframe 4.2 user block (frontend-patterns §2). The avatar alone shows in icon mode. */}
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8 shrink-0">
            {user.imageUrl ? <AvatarImage src={user.imageUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">{initialsOf(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {tUser("role")}: {tRole(user.role)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 group-data-[collapsible=icon]:hidden"
            aria-label={tAuth("signOut")}
            title={tAuth("signOut")}
            onClick={() => router.push("/sign-in")}
          >
            <LogOut aria-hidden />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail aria-label={tShell("toggle")} title={tShell("toggle")} />
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
