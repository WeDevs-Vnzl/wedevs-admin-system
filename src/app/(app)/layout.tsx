import { AlertsBell } from "@/components/app/alerts-bell";
import { AppBreadcrumbs } from "@/components/app/app-breadcrumbs";
import { AppFooter } from "@/components/app/app-footer";
import { AppSidebar, SidebarToggle } from "@/components/app/app-sidebar";
import { CommandMenu } from "@/components/app/command-menu";
import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { RateChip } from "@/components/app/rate-chip";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getShellData } from "@/features/shell/queries";
import { can } from "@/server/auth/permissions";

// The authenticated shell (PRD §7.1, frontend-patterns §2, wireframes 4.2/4.4): sidebar, topbar with the
// Cmd+K trigger, rate chip, alerts, locale and theme, user menu, and the footer.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shell = await getShellData();

  return (
    <SidebarProvider>
      <AppSidebar user={shell.user} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-4">
          <SidebarToggle />
          <AppBreadcrumbs />
          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            <CommandMenu user={shell.user} />
            <RateChip
              rate={shell.vesRate}
              missing={shell.vesRateMissing}
              canManage={can(shell.user, "read", "settings")}
            />
            <AlertsBell count={shell.alertCount} />
            <LocaleSwitcher />
            <ThemeToggle />
            <UserMenu user={shell.user} />
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}
