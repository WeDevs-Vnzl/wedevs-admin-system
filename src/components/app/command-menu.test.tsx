import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNav from "@/i18n/messages/en/nav.json";
import enSearch from "@/i18n/messages/en/search.json";
import esNav from "@/i18n/messages/es/nav.json";
import esSearch from "@/i18n/messages/es/search.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/server/auth/types";
import { CommandMenu } from "./command-menu";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

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

function renderMenu(role: SessionUser["role"], locale: "en" | "es" = "en") {
  const messages =
    locale === "es" ? { nav: esNav, search: esSearch } : { nav: enNav, search: enSearch };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TooltipProvider>
        <CommandMenu user={userWithRole(role)} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

function openWithShortcut() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
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

    openWithShortcut();
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
    openWithShortcut();
    await userEvent.click(await screen.findByRole("option", { name: /Invoices/ }));
    expect(push).toHaveBeenCalledWith("/invoices");
  });

  it("offers the quick actions an Owner may run", async () => {
    renderMenu("OWNER");
    openWithShortcut();
    expect(
      await screen.findByRole("option", { name: enSearch.actions.newInvoice }),
    ).toBeInTheDocument();
  });

  it("filters quick actions by can(): a Viewer gets no create actions", async () => {
    renderMenu("VIEWER");
    openWithShortcut();
    await screen.findByRole("dialog");
    expect(screen.queryByText(enSearch.actions.newInvoice)).not.toBeInTheDocument();
    expect(screen.queryByText(enSearch.quickActions)).not.toBeInTheDocument();
  });

  it("finds Spanish labels with Spanish queries (M2): 'factu' lists Facturas", async () => {
    const user = userEvent.setup();
    renderMenu("OWNER", "es");
    openWithShortcut();
    await user.type(await screen.findByRole("combobox"), "factu");
    expect(await screen.findByRole("option", { name: /Facturas/ })).toBeInTheDocument();
  });

  it("finds quick actions by their Spanish label (M2): 'pago' lists Registrar pago", async () => {
    const user = userEvent.setup();
    renderMenu("OWNER", "es");
    openWithShortcut();
    await user.type(await screen.findByRole("combobox"), "pago");
    expect(await screen.findByRole("option", { name: "Registrar pago" })).toBeInTheDocument();
  });

  it("still finds English keys in English (M2): 'invoices' lists Invoices", async () => {
    const user = userEvent.setup();
    renderMenu("OWNER", "en");
    openWithShortcut();
    await user.type(await screen.findByRole("combobox"), "invoices");
    expect(await screen.findByRole("option", { name: /Invoices/ })).toBeInTheDocument();
  });

  it("names the combobox and the listbox in the active language (R1)", async () => {
    renderMenu("OWNER", "es");
    openWithShortcut();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: esSearch.dialogTitle })).toBeInTheDocument();
    expect(within(dialog).getByRole("listbox", { name: esSearch.listLabel })).toBeInTheDocument();
  });

  it("keeps the pending note out of the listbox (R9)", async () => {
    renderMenu("OWNER");
    openWithShortcut();
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByText(enSearch.resultsPending)).not.toBeInTheDocument();
    expect(screen.getByText(enSearch.resultsPending)).toBeInTheDocument();
  });

  it("composes the dialog with its title and description inside it (R5)", async () => {
    renderMenu("OWNER", "es");
    // Closed: no heading or description is rendered anywhere on the page.
    expect(screen.queryByText(esSearch.dialogTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(esSearch.dialogDescription)).not.toBeInTheDocument();

    openWithShortcut();
    const dialog = await screen.findByRole("dialog", { name: esSearch.dialogTitle });
    expect(dialog).toHaveAccessibleDescription(esSearch.dialogDescription);
    expect(within(dialog).getByRole("heading", { name: esSearch.dialogTitle })).toBeInTheDocument();
  });
});
