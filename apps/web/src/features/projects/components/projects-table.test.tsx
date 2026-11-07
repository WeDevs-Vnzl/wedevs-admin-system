import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: { page: 1, pageSize: 25, includeArchived: false, filters: {} } as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/projects/actions", () => ({
  exportProjectsCsvAction: vi.fn(),
  listProjectsAction: vi.fn(),
}));
vi.mock("@/features/clients/actions", () => ({ searchClientsAction: vi.fn() }));
vi.mock("@/features/export/use-csv-export", () => ({ useCsvExport: () => vi.fn() }));
vi.mock("@/features/tags/components/tag-picker", () => ({ TagPicker: () => null }));
vi.mock("@/components/ui/data-table", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/data-table")>();
  return { ...original, useTableUrlState: () => ({ query: mocks.query, setQuery: vi.fn() }) };
});

import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import enTable from "@/i18n/messages/en/table.json";
import enTags from "@/i18n/messages/en/tags.json";
import type { ProjectListRowDto } from "@/lib/api/types/projects";
import { ProjectsTable, type ProjectsTableProps } from "./projects-table";

const messages = {
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  patterns: enPatterns,
  projects: enProjects,
  table: enTable,
  tags: enTags,
};

const base: ProjectListRowDto = {
  id: "pry_1",
  code: "PRY-0001",
  name: "Sitio Kairos",
  status: "EN_CURSO",
  clients: [],
  stack: [],
  tags: [],
  startDate: null,
  targetEndDate: null,
  archivedAt: null,
  contractedValueUsd: "5000.00",
  invoicedUsd: "2000.00",
  collectedUsd: "1000.00",
  toInvoiceUsd: null,
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderTable(overrides: Partial<ProjectsTableProps> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
      <ProjectsTable
        initialRows={[base]}
        initialTotal={1}
        technologies={[]}
        tags={[]}
        icons={{}}
        showFinancials
        canCreate={false}
        canArchive={false}
        canTag={false}
        canCreateTags={false}
        canRestore={false}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("ProjectsTable money (C13, C15)", () => {
  it("shows the money columns for finance roles: amounts as the BE sent them, null as a dash", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: /Contracted/ })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /PRY-0001/ });
    expect(within(row).getByText(/5,000\.00/)).toBeInTheDocument();
    // `toInvoiceUsd` is null: a dash, never a zero amount.
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).queryByText(/\$0\.00/)).toBeNull();
  });

  it("does not render the money columns for roles without the finance grant", () => {
    renderTable({ showFinancials: false });
    expect(screen.queryByRole("columnheader", { name: /Contracted/ })).toBeNull();
    expect(screen.queryByText(/5,000\.00/)).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeInTheDocument();
  });
});
