import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enAuth from "@/i18n/messages/en/auth.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enNav from "@/i18n/messages/en/nav.json";
import enShell from "@/i18n/messages/en/shell.json";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/server/auth/types";
import { AppSidebar } from "./app-sidebar";

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));

const messages = {
  nav: enNav,
  shell: enShell,
  common: enCommon,
  auth: enAuth,
  enums: enEnums,
};

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

function renderSidebar(role: SessionUser["role"], options: { defaultOpen?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TooltipProvider>
        <SidebarProvider defaultOpen={options.defaultOpen ?? true}>
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

  beforeEach(() => {
    mocks.push.mockClear();
    mocks.pathname = "/dashboard";
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

  it("hides finance, reports and activity from a Viewer but keeps configuration (M1)", () => {
    renderSidebar("VIEWER");
    const nav = screen.getByRole("navigation", { name: enShell.sidebar.label });
    expect(within(nav).getByRole("link", { name: "Clients" })).toBeInTheDocument();
    for (const label of ["Invoices", "Payments", "Expenses", "Accounts", "Reports", "Activity"]) {
      expect(within(nav).queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: enNav.items.settings })).toBeInTheDocument();
  });

  it("shows configuration to a Member (M1: the settings frame narrows the sections)", () => {
    renderSidebar("MEMBER");
    expect(screen.getByRole("link", { name: enNav.items.settings })).toBeInTheDocument();
  });

  it("marks the current route with aria-current", () => {
    renderSidebar("OWNER");
    expect(screen.getByRole("link", { name: enNav.items.dashboard })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks only the portal links entry under /documents/shares, not documents", () => {
    mocks.pathname = "/documents/shares/shl_1";
    renderSidebar("OWNER");
    expect(screen.getByRole("link", { name: enNav.items.shares })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: enNav.items.documents })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the configuration link with aria-current under /settings (R8)", () => {
    mocks.pathname = "/settings/preferences";
    renderSidebar("MEMBER");
    expect(screen.getByRole("link", { name: enNav.items.settings })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders the user block with name and role, and signs out to /sign-in (m3)", async () => {
    const user = userEvent.setup();
    renderSidebar("MEMBER");
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(
      screen.getByText(`${enShell.userMenu.role}: ${enEnums.UserRole.MEMBER}`),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: enAuth.signOut }));
    expect(mocks.push).toHaveBeenCalledWith("/sign-in");
  });

  it("names the collapsed brand link so it is reachable by name (R3)", () => {
    renderSidebar("OWNER", { defaultOpen: false });
    expect(screen.getByRole("link", { name: enCommon.app.name })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("gives the sidebar rail translated labels (m4, R2)", () => {
    renderSidebar("OWNER");
    const rail = document.querySelector('[data-sidebar="rail"]');
    expect(rail).toHaveAttribute("aria-label", enShell.sidebar.toggle);
    expect(rail).toHaveAttribute("title", enShell.sidebar.toggle);
  });
});
