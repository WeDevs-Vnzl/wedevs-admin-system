import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCatalogs from "@/i18n/messages/en/catalogs.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import type { TechnologyListRowDTO } from "@/lib/validators/technologies";
import {
  deleteTechnologyAction,
  listTechnologiesAction,
  resolveTechnologyIconAction,
  setTechnologyActiveAction,
} from "@/features/technologies/actions";
import { TechnologiesTable } from "./technologies-table";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  query: { page: 1, pageSize: 25, includeArchived: false, filters: {} } as Record<string, unknown>,
}));

vi.mock("@/features/technologies/actions", () => ({
  createTechnologyAction: vi.fn(),
  updateTechnologyAction: vi.fn(),
  setTechnologyActiveAction: vi.fn(),
  deleteTechnologyAction: vi.fn(),
  listTechnologiesAction: vi.fn(),
  resolveTechnologyIconAction: vi.fn(),
  exportTechnologiesCsvAction: vi.fn(),
}));
vi.mock("@/features/export/use-csv-export", () => ({ useCsvExport: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/ui/data-table", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/data-table")>();
  return {
    ...original,
    useTableUrlState: () => ({
      query: mocks.query,
      setQuery: vi.fn(),
    }),
  };
});

const rows: TechnologyListRowDTO[] = [
  {
    id: "tec_next_js",
    name: "Next.js",
    nameEn: null,
    slug: "next-js",
    category: "FRONTEND",
    iconSlug: "nextdotjs",
    color: null,
    active: true,
    usageCount: 2,
  },
  {
    id: "tec_rust",
    name: "Rust",
    nameEn: "Rust (lang)",
    slug: "rust",
    category: "LENGUAJE",
    iconSlug: null,
    color: "#dea584",
    active: false,
    usageCount: 0,
  },
  {
    id: "tec_legacy",
    name: "Legacy",
    nameEn: null,
    slug: "legacy",
    category: "OTRO",
    iconSlug: null,
    color: null,
    active: true,
    usageCount: 3,
  },
];

function tree() {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        catalogs: enCatalogs,
        enums: enEnums,
        common: enCommon,
        table: enTable,
        patterns: enPatterns,
      }}
    >
      <TechnologiesTable rows={rows} total={rows.length} icons={{}} />
    </NextIntlClientProvider>
  );
}

function renderTable() {
  return render(tree());
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.mocked(listTechnologiesAction).mockResolvedValue({
    ok: true,
    data: { items: rows, total: rows.length, page: 1, pageSize: 25, pageCount: 1 },
  } as never);
  vi.mocked(setTechnologyActiveAction).mockResolvedValue({ ok: true, data: {} } as never);
  vi.mocked(deleteTechnologyAction).mockResolvedValue({
    ok: true,
    data: { id: "tec_rust" },
  } as never);
});

afterEach(() => {
  mocks.query = { page: 1, pageSize: 25, includeArchived: false, filters: {} };
  vi.clearAllMocks();
});

describe("TechnologiesTable", () => {
  it("shows the English name in English, and the usage count with its plural", () => {
    renderTable();
    expect(screen.getAllByText("Rust (lang)").length).toBeGreaterThan(0);
    expect(screen.getByText("3 projects")).toBeInTheDocument();
    expect(screen.getByText("No projects")).toBeInTheDocument();
  });

  it("activates and deactivates through the switch", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("switch", { name: "Deactivate Next.js" }));
    await waitFor(() =>
      expect(setTechnologyActiveAction).toHaveBeenCalledWith({ id: "tec_next_js", active: false }),
    );
  });

  it("locks the delete of a technology in use and offers deactivation instead (HU-06 CA3)", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Delete Legacy" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Technology in use")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(setTechnologyActiveAction).toHaveBeenCalledWith({ id: "tec_legacy", active: false }),
    );
    expect(deleteTechnologyAction).not.toHaveBeenCalled();
  });

  it("deletes an unused technology after the confirmation", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Delete Rust (lang)" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteTechnologyAction).toHaveBeenCalledWith({ id: "tec_rust" }));
  });

  it("follows the URL query: the rows, the total and the server-resolved icons come from the filtered set", async () => {
    const rust = rows[1]!;
    const next = { ...rows[0]!, id: "tec_next_2", name: "Nextra", iconSlug: "react" };
    vi.mocked(listTechnologiesAction).mockResolvedValue({
      ok: true,
      data: { items: [next, rust], total: 2, page: 1, pageSize: 25, pageCount: 1 },
    } as never);
    vi.mocked(resolveTechnologyIconAction).mockResolvedValue({
      ok: true,
      data: { path: "M0 0h1v1z", hex: "000000", title: "Next.js" },
    } as never);
    const view = renderTable();
    expect(listTechnologiesAction).not.toHaveBeenCalled();
    expect(screen.getByText("Legacy")).toBeInTheDocument();

    mocks.query = {
      page: 1,
      pageSize: 25,
      includeArchived: false,
      q: "ne",
      filters: { category: ["FRONTEND"], active: ["true"] },
    };
    view.rerender(tree());

    expect(await screen.findByText("Nextra")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Legacy")).toBeNull());
    expect(listTechnologiesAction).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ne", category: ["FRONTEND"], active: "true" }),
    );
    expect(resolveTechnologyIconAction).toHaveBeenCalledWith({ slug: "react" });
    expect(screen.getByRole("img", { name: "Nextra" }).tagName.toLowerCase()).toBe("svg");
  });
});
