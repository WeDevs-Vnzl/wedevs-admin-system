import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enAuth from "@/i18n/messages/en/auth.json";
import enCommon from "@/i18n/messages/en/common.json";
import enNav from "@/i18n/messages/en/nav.json";
import enShell from "@/i18n/messages/en/shell.json";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/server/auth/types";
import { AppSidebar } from "./app-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const messages = { nav: enNav, shell: enShell, common: enCommon, auth: enAuth };

function userWithRole(role: SessionUser["role"]): SessionUser {
  return {
    id: `usr_${role.toLowerCase()}`,
    name: "Test User",
    email: "test.user@example.com",
    imageUrl: null,
    role,
    locale: "en",
    theme: "system",
  };
}

function renderSidebar(role: SessionUser["role"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar user={userWithRole(role)} />
        </SidebarProvider>
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe("AppSidebar", () => {
  beforeAll(() => {
    // The registry sidebar asks the viewport width through matchMedia, which jsdom does not provide.
    window.matchMedia ??= (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });

  it("shows every module to an Owner, including configuration", () => {
    renderSidebar("OWNER");
    const nav = screen.getByRole("navigation", { name: enShell.sidebar.label });
    for (const label of [
      "Clients",
      "Invoices",
      "Payments",
      "Expenses",
      "Accounts",
      "Reports",
      "Activity",
    ]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: enNav.items.settings })).toBeInTheDocument();
  });

  it("hides finance, reports, activity and configuration from a Viewer (PRD §4.3 via can())", () => {
    renderSidebar("VIEWER");
    const nav = screen.getByRole("navigation", { name: enShell.sidebar.label });
    expect(within(nav).getByRole("link", { name: "Clients" })).toBeInTheDocument();
    for (const label of ["Invoices", "Payments", "Expenses", "Accounts", "Reports", "Activity"]) {
      expect(within(nav).queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: enNav.items.settings })).not.toBeInTheDocument();
  });

  it("marks the current route with aria-current", () => {
    renderSidebar("OWNER");
    expect(screen.getByRole("link", { name: enNav.items.dashboard })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
