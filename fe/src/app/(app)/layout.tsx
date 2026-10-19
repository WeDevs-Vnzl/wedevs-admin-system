import { AlertsBell } from "@/components/app/alerts-bell";
import { BreadcrumbLabelProvider } from "@/components/app/breadcrumb-label";
import { AppBreadcrumbs } from "@/components/app/app-breadcrumbs";
import { AppFooter } from "@/components/app/app-footer";
import { AppSidebar, SidebarToggle } from "@/components/app/app-sidebar";
import { CommandMenu } from "@/components/app/command-menu";
import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { RateChip } from "@/components/app/rate-chip";
import { SkipLink } from "@/components/app/skip-link";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { countUnreadAlerts } from "@/features/alerts/queries";
import { getShellData } from "@/features/shell/queries";
import { can } from "@/server/auth/permissions";

// `id` of the content container: the skip link moves focus there (WCAG 2.4.1).
const MAIN_CONTENT_ID = "main-content";

// The authenticated shell (PRD §7.1, frontend-patterns §2, wireframes 4.2/4.4): sidebar, topbar with the
// Cmd+K trigger, rate chip, alerts, locale and theme, user menu, and the footer. From 768 to 1023 px the sidebar
// still takes 16rem, so the topbar controls shrink (icon-only Cmd+K, rate without label) instead of overflowing.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [shell, unreadAlerts] = await Promise.all([getShellData(), countUnreadAlerts()]);

  return (
    <BreadcrumbLabelProvider>
      <SidebarProvider>
        <SkipLink targetId={MAIN_CONTENT_ID} />
        <AppSidebar user={shell.user} />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-4">
            <SidebarToggle />
            <AppBreadcrumbs />
            <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:gap-2">
              <CommandMenu user={shell.user} />
              <RateChip
                rate={shell.vesRate}
                missing={shell.vesRateMissing}
                canManage={can(shell.user, "read", "settings")}
              />
              <AlertsBell count={unreadAlerts} />
              <LocaleSwitcher />
              <ThemeToggle />
              <UserMenu user={shell.user} />
            </div>
          </header>
          <div
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex min-w-0 flex-1 scroll-mt-16 flex-col gap-6 p-4 outline-none md:p-6"
          >
            {children}
          </div>
          <AppFooter />
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbLabelProvider>
  );
}
