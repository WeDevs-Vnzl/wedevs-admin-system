import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en/table.json";
import { listQuerySchema } from "@/lib/validators/common";
import { DataTable } from "./data-table";
import { createDataTableColumnHelper, type DataTableColumnDef } from "./features";
import type { ColumnConfig } from "./types";

type Row = { id: string; code: string; name: string; email: string };

const rows: Row[] = [
  { id: "c-1", code: "CL-001", name: "Acme", email: "ops@acme.test" },
  { id: "c-2", code: "CL-002", name: "Globex", email: "hi@globex.test" },
];

const helper = createDataTableColumnHelper<Row>();
const columns: DataTableColumnDef<Row>[] = [
  helper.accessor("code", { header: "Code", meta: { label: "Code", sortable: true, pinned: true } }),
  helper.accessor("name", { header: "Name", meta: { label: "Name", sortable: true, pinned: true } }),
  helper.accessor("email", { header: "Email", meta: { label: "Email" } }),
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const onQueryChange = vi.fn();
  const onColumnsChange = vi.fn<(columns: ColumnConfig[]) => void>();
  const query = listQuerySchema.parse({});
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ table: en }} timeZone="UTC">
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={rows.length}
        query={query}
        onQueryChange={onQueryChange}
        emptyState={{ title: en.empty.title, description: en.empty.description }}
        onColumnsChange={onColumnsChange}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onQueryChange, onColumnsChange };
}

describe("DataTable", () => {
  it("renders the server page rows and the total range", () => {
    renderTable();

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
  });

  it("shows the empty state with its message when there are no rows", () => {
    renderTable({ data: [], total: 0 });

    expect(screen.getByText(en.empty.title)).toBeInTheDocument();
    expect(screen.getByText(en.empty.description)).toBeInTheDocument();
  });

  it("reports the sort through the query when a sortable header is clicked", async () => {
    const { onQueryChange } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Sort by Code" }));

    expect(onQueryChange).toHaveBeenCalledWith({ sort: "code:asc" });
  });

  it("reports the whole column config when a column is hidden from view options", async () => {
    const { onColumnsChange } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Email" }));

    expect(onColumnsChange).toHaveBeenCalledTimes(1);
    const config = onColumnsChange.mock.calls[0]?.[0] ?? [];
    expect(config.find((column) => column.id === "email")?.visible).toBe(false);
    expect(config.find((column) => column.id === "code")?.visible).toBe(true);
  });

  it("offers the bulk bar only after a row is selected", async () => {
    const bulkActions = vi.fn(() => <button type="button">Archive</button>);
    renderTable({ bulkActions });

    expect(screen.queryByRole("region", { name: en.bulk.region })).toBeNull();

    const rowCheckbox = screen.getByRole("checkbox", { name: "Select row c-1" });
    await userEvent.click(rowCheckbox);

    const bar = await screen.findByRole("region", { name: en.bulk.region });
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();
    expect(bulkActions).toHaveBeenLastCalledWith(["c-1"]);
  });

  it("shows skeleton rows while loading", () => {
    const { container } = renderTable({ loading: true });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("keeps the search draft local until the debounce fires", () => {
    vi.useFakeTimers();
    try {
      const { onQueryChange } = renderTable();
      fireEvent.change(screen.getByRole("searchbox", { name: en.search.label }), { target: { value: "acme" } });

      expect(onQueryChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(onQueryChange).toHaveBeenCalledWith({ q: "acme" });
    } finally {
      vi.useRealTimers();
    }
  });
});
