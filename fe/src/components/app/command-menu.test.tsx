import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enEnums from "@/i18n/messages/en/enums.json";
import enNav from "@/i18n/messages/en/nav.json";
import enSearch from "@/i18n/messages/en/search.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esNav from "@/i18n/messages/es/nav.json";
import esSearch from "@/i18n/messages/es/search.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { searchGlobalAction } from "@/features/search/actions";
import { searchGlobalInputSchema } from "@/lib/validators/search";
import { searchGlobal } from "@/mocks/services/search";
import { makeTestContext } from "@/mocks/test-helpers";
import type { SessionUser } from "@/server/auth/types";
import { BreadcrumbLabel, BreadcrumbLabelProvider } from "./breadcrumb-label";
import { CommandMenu } from "./command-menu";

const push = vi.fn();
const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/features/search/actions", () => ({ searchGlobalAction: vi.fn() }));

// The real mock search over a fixture store with the HU-26 records added: "Talleres García",
// "Grupo Inversión" and an invoice coded FAC-0012.
function seedSearch() {
  const { ctx, db } = makeTestContext("OWNER");
  const base = db.clients.find((row) => !row.archivedAt)!;
  for (const [id, name] of [
    ["cli_garcia", "Talleres García"],
    ["cli_inversion", "Grupo Inversión"],
  ] as const) {
    db.clients.push({
      ...structuredClone(base),
      id,
      code: `CLI-9${db.clients.length}`,
      tradeName: name,
      legalName: `${name} C.A.`,
    });
  }
  const invoice = db.invoices.find((row) => row.code === "FAC-0003")!;
  db.invoices.push({ ...structuredClone(invoice), id: "inv_twelve", code: "FAC-0012" });
  vi.mocked(searchGlobalAction).mockImplementation((async (input: unknown) => ({
    ok: true,
    data: await searchGlobal(ctx, searchGlobalInputSchema.parse(input)),
  })) as never);
  return { db, invoice };
}

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

function renderMenu(
  role: SessionUser["role"],
  locale: "en" | "es" = "en",
  extra: React.ReactNode = null,
) {
  const messages =
    locale === "es"
      ? { nav: esNav, search: esSearch, enums: esEnums }
      : { nav: enNav, search: enSearch, enums: enEnums };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TooltipProvider>
        <BreadcrumbLabelProvider>
          {extra}
          <CommandMenu user={userWithRole(role)} />
        </BreadcrumbLabelProvider>
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
    nav.pathname = "/dashboard";
    window.localStorage.clear();
    seedSearch();
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

  it("returns focus to the trigger when Escape closes the menu (D4)", async () => {
    const user = userEvent.setup();
    renderMenu("OWNER");
    const trigger = screen.getByRole("button", { name: enSearch.trigger });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("returns focus to the trigger also when Ctrl+K opened the menu (D4)", async () => {
    const user = userEvent.setup();
    renderMenu("OWNER");
    openWithShortcut();
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: enSearch.trigger })).toHaveFocus();
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
    expect(
      within(dialog).getByRole("combobox", { name: esSearch.dialogTitle }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("listbox", { name: esSearch.listLabel })).toBeInTheDocument();
  });

  it("keeps the prefix hint out of the listbox (R9)", async () => {
    renderMenu("OWNER");
    openWithShortcut();
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByText(enSearch.prefixHint)).not.toBeInTheDocument();
    expect(screen.getByText(enSearch.prefixHint)).toBeInTheDocument();
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

  describe("record search (PRD §7.6, HU-26)", () => {
    it('CA1: "garcia" finds "García" (ignores accents)', async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "garcia");
      expect(await screen.findByRole("option", { name: /Talleres García/ })).toBeInTheDocument();
    });

    it('CA2: "invsion" finds "Inversión" (trigram similarity)', async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "invsion");
      expect(await screen.findByRole("option", { name: /Grupo Inversión/ })).toBeInTheDocument();
    });

    it("CA3: the code FAC-0012 goes straight to that invoice on Enter", async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "FAC-0012");
      const option = await screen.findByRole("option", { name: /FAC-0012/ });
      await waitFor(() => expect(option).toHaveAttribute("aria-selected", "true"));
      await user.keyboard("{Enter}");
      expect(push).toHaveBeenCalledWith("/invoices/inv_twelve");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("groups hits by type and shows icon, code, title, subtitle and translated status", async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "garcia");
      const option = await screen.findByRole("option", { name: /Talleres García/ });
      const group = option.closest("[cmdk-group]") as HTMLElement;
      expect(within(group).getByText(enSearch.types.CLIENT)).toBeInTheDocument();
      expect(option.querySelector('[data-entity-icon="CLIENT"]')).not.toBeNull();
      expect(option).toHaveTextContent(/CLI-9\d+/);
      expect(option).toHaveTextContent("Talleres García C.A.");
      expect(option).toHaveTextContent(enEnums.ClientStatus.ACTIVO);
      await user.click(option);
      expect(push).toHaveBeenCalledWith("/clients/cli_garcia");
    });

    it("the `c:` prefix narrows to clients and `f:` to invoices", async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      const input = await screen.findByRole("combobox");
      await user.type(input, "c: garcia");
      expect(await screen.findByRole("option", { name: /Talleres García/ })).toBeInTheDocument();
      expect(vi.mocked(searchGlobalAction)).toHaveBeenLastCalledWith({ q: "c: garcia" });

      await user.clear(input);
      await user.type(input, "f: garcia");
      await waitFor(() =>
        expect(vi.mocked(searchGlobalAction)).toHaveBeenLastCalledWith({ q: "f: garcia" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("option", { name: /Talleres García/ })).not.toBeInTheDocument(),
      );
    });

    it("does not search while the query is empty or only a prefix", async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "c:");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(searchGlobalAction).not.toHaveBeenCalled();
    });
  });

  describe("recently visited records", () => {
    it("lists a record opened from the search when the menu opens again", async () => {
      const user = userEvent.setup();
      renderMenu("OWNER");
      openWithShortcut();
      await user.type(await screen.findByRole("combobox"), "garcia");
      await user.click(await screen.findByRole("option", { name: /Talleres García/ }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      push.mockClear();
      openWithShortcut();
      const recent = await screen.findByRole("group", { name: enSearch.recent });
      await user.click(within(recent).getByRole("option", { name: /Talleres García/ }));
      expect(push).toHaveBeenCalledWith("/clients/cli_garcia");
    });

    it("records the detail page the user visits, named by its breadcrumb label", async () => {
      nav.pathname = "/projects/pry_1";
      renderMenu("OWNER", "en", <BreadcrumbLabel segment="pry_1" label="PRY-0001 · Web" />);
      openWithShortcut();
      const recent = await screen.findByRole("group", { name: enSearch.recent });
      expect(within(recent).getByRole("option", { name: /PRY-0001 · Web/ })).toBeInTheDocument();
    });

    it("keeps recents per user and shows none for a fresh user", async () => {
      window.localStorage.setItem(
        "wedevs:recent-records:usr_admin",
        JSON.stringify([
          {
            entityType: "CLIENT",
            entityId: "cli_x",
            title: "Other",
            code: null,
            href: "/clients/cli_x",
          },
        ]),
      );
      renderMenu("OWNER");
      openWithShortcut();
      await screen.findByRole("dialog");
      expect(screen.queryByRole("group", { name: enSearch.recent })).not.toBeInTheDocument();
    });
  });
});
