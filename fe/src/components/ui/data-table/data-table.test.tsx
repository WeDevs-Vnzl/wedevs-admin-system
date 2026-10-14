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

  it("never sends display-only columns (selection, meta.exportable === false) to onExport", async () => {
    const withActions: DataTableColumnDef<Row>[] = [
      ...columns,
      helper.display({
        id: "actions",
        header: "Actions",
        cell: () => <button type="button">Edit</button>,
        meta: { label: "Actions", hideable: false, exportable: false },
      }),
    ];
    const onExport = vi.fn();
    renderTable({ columns: withActions, onExport });

    await userEvent.click(screen.getByRole("button", { name: en.export.label }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls[0]?.[1]).toEqual(["code", "name", "email"]);
  });

  it("exports only the visible exportable columns, in display order", async () => {
    const onExport = vi.fn();
    renderTable({
      onExport,
      initialColumns: [
        { id: "email", visible: true },
        { id: "code", visible: false },
        { id: "name", visible: true },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: en.export.label }));
    expect(onExport.mock.calls[0]?.[1]).toEqual(["email", "name"]);
  });

  it("walks sort asc → desc → none through the query", async () => {
    const asc = renderTable({ query: listQuerySchema.parse({ sort: "code:asc" }) });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Code" }));
    expect(asc.onQueryChange).toHaveBeenLastCalledWith({ sort: "code:desc" });
    asc.unmount();

    const desc = renderTable({ query: listQuerySchema.parse({ sort: "code:desc" }) });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Code" }));
    expect(desc.onQueryChange).toHaveBeenLastCalledWith({ sort: undefined });
  });

  it("clears the selection when the query scope changes", async () => {
    const { rerender, onQueryChange } = renderTable({ bulkActions: () => <span>bulk</span> });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select row c-1" }));
    expect(screen.getByRole("region", { name: en.bulk.region })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ table: en }} timeZone="UTC">
        <DataTable<Row>
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          total={rows.length}
          query={listQuerySchema.parse({ q: "acme" })}
          onQueryChange={onQueryChange}
          emptyState={{ title: "none" }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("region", { name: en.bulk.region })).toBeNull();
  });

  describe("column layout", () => {
    const layoutColumns: DataTableColumnDef<Row>[] = [
      helper.accessor("code", { header: "Code", meta: { label: "Code", sortable: true } }),
      helper.accessor("name", { header: "Name", meta: { label: "Name", sortable: true, pinned: true } }),
      helper.accessor("email", { header: "Email", size: 200, meta: { label: "Email", align: "end", wrap: true } }),
    ];

    it("keeps the selection column first and pins it with the pinned columns, so it is never covered", () => {
      renderTable({ columns: layoutColumns });

      const headers = screen.getAllByRole("columnheader");
      expect(within(headers[0]!).getByRole("checkbox", { name: "Select all rows on this page" })).toBeInTheDocument();
      expect(headers[1]).toHaveTextContent("Name");
      expect(headers[0]).toHaveClass("sticky");
      expect(headers[0]).toHaveStyle({ left: "0px" });
      expect(headers[1]).toHaveClass("sticky");
      expect(headers[1]).toHaveStyle({ left: "40px" });
    });

    it("marks the edge of the pinned block with an inset shadow on the last pinned column only", () => {
      renderTable({ columns: layoutColumns });

      const headers = screen.getAllByRole("columnheader");
      expect(headers[0]!.className).not.toMatch(/shadow-\[inset_-1px/);
      expect(headers[1]!.className).toMatch(/shadow-\[inset_-1px/);
    });

    it("sizes the table to the sum of its column widths so it scrolls instead of squeezing", () => {
      renderTable({ columns: layoutColumns });

      // select 40 + code 150 + name 150 + email 200
      expect(screen.getByRole("table")).toHaveStyle({ width: "540px" });
      expect(screen.getByRole("table")).toHaveClass("table-fixed");
    });

    it("clips every cell to its column and truncates single-line content", () => {
      renderTable({ columns: layoutColumns });

      const cell = screen.getByText("Acme").closest("td");
      expect(cell).toHaveClass("overflow-hidden", "truncate");
      for (const header of screen.getAllByRole("columnheader")) expect(header).toHaveClass("overflow-hidden");
    });

    it("truncates a long header label and keeps the full label as its title", () => {
      renderTable({ columns: layoutColumns });

      const label = within(screen.getByRole("button", { name: "Sort by Code" })).getByText("Code");
      expect(label).toHaveClass("truncate");
      expect(label).toHaveAttribute("title", "Code");
    });

    it("wraps meta.wrap cells and right-aligns meta.align end cells with tabular numbers", () => {
      renderTable({ columns: layoutColumns });

      const cell = screen.getByText("ops@acme.test").closest("td");
      expect(cell).toHaveClass("whitespace-normal", "text-right", "tabular-nums");
      expect(cell).not.toHaveClass("truncate");
      const header = screen.getAllByRole("columnheader")[3]!;
      expect(header).toHaveClass("text-right");
    });
  });

  describe("compact variant", () => {
    function renderCompact(data: Row[] = rows, embedded = false) {
      return render(
        <NextIntlClientProvider locale="en" messages={{ table: en }} timeZone="UTC">
          <DataTable<Row>
            variant="compact"
            embedded={embedded}
            data={data}
            columns={columns}
            getRowId={(row) => row.id}
            emptyState={{ title: en.empty.title }}
          />
        </NextIntlClientProvider>,
      );
    }

    it("renders every row in the shared frame without toolbar, selection, sorting or pagination", () => {
      const { container } = renderCompact();

      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Sort by Code" })).toBeNull();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByText("1–2 of 2")).toBeNull();
      expect(container.querySelector("thead")).toHaveClass("bg-table-head");
      expect(container.querySelector("th")).toHaveClass("sticky");
    });

    it("draws its own frame by default and none when embedded in a card", () => {
      const framed = renderCompact().container.querySelector("table")!.parentElement!.parentElement!;
      expect(framed).toHaveClass("rounded-xl", "border", "bg-card");

      const embedded = renderCompact(rows, true).container.querySelector("[data-embedded]");
      expect(embedded).not.toBeNull();
      expect(embedded).not.toHaveClass("rounded-xl");
      expect(embedded).not.toHaveClass("bg-card");
      expect(screen.getAllByText("Acme")).toHaveLength(2);
    });

    it("shows the empty state inside the table when there are no rows", () => {
      renderCompact([]);

      expect(screen.getByText(en.empty.title)).toBeInTheDocument();
    });
  });
});
