import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNav from "@/i18n/messages/en/nav.json";
import enSearch from "@/i18n/messages/en/search.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/server/auth/types";
import { CommandMenu } from "./command-menu";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const messages = { nav: enNav, search: enSearch };

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

function renderMenu(role: SessionUser["role"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TooltipProvider>
        <CommandMenu user={userWithRole(role)} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe("CommandMenu", () => {
  beforeAll(() => {
    // cmdk scrolls the highlighted item into view, which jsdom does not implement.
    Element.prototype.scrollIntoView ??= () => {};
    // cmdk measures the list with ResizeObserver, which jsdom does not provide.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    push.mockClear();
  });

  it("opens with Ctrl+K and Cmd+K and closes on a second Ctrl+K", async () => {
    renderMenu("OWNER");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the topbar trigger", async () => {
    renderMenu("OWNER");
    await userEvent.click(screen.getByRole("button", { name: enSearch.trigger }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("navigates to a module from nav.ts", async () => {
    renderMenu("OWNER");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: /Invoices/ }));
    expect(push).toHaveBeenCalledWith("/invoices");
  });

  it("offers the quick actions an Owner may run", async () => {
    renderMenu("OWNER");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(
      await screen.findByRole("option", { name: enSearch.actions.newInvoice }),
    ).toBeInTheDocument();
  });

  it("filters quick actions by can(): a Viewer gets no create actions", async () => {
    renderMenu("VIEWER");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await screen.findByRole("dialog");
    expect(screen.queryByText(enSearch.actions.newInvoice)).not.toBeInTheDocument();
    expect(screen.queryByText(enSearch.quickActions)).not.toBeInTheDocument();
  });
});
