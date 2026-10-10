import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enTable from "@/i18n/messages/en/table.json";
import { listQuerySchema, type ListQueryInput } from "@/lib/validators/common";
import { DataTableExportButton } from "./data-table-export-button";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar, facetValuesOf } from "./data-table-toolbar";
import { DataTableViewOptions, type ViewColumn } from "./data-table-view-options";
import type { ColumnConfig, FacetConfig } from "./types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

function intl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ table: enTable }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DataTableExportButton", () => {
  it("calls onExport and respects disabled", async () => {
    const onExport = vi.fn();
    const view = intl(<DataTableExportButton onExport={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    view.unmount();

    intl(<DataTableExportButton onExport={onExport} disabled />);
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});

describe("DataTablePagination", () => {
  const base = { pageSize: 25 as const, total: 60, onPageChange: vi.fn(), onPageSizeChange: vi.fn() };

  it("shows the range and moves between pages", async () => {
    const onPageChange = vi.fn();
    intl(<DataTablePagination {...base} page={2} onPageChange={onPageChange} />);

    expect(screen.getByText("26–50 of 60")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("disables previous on the first page and next on the last", () => {
    const first = intl(<DataTablePagination {...base} page={1} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    first.unmount();
    intl(<DataTablePagination {...base} page={3} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("sends a hand-edited page beyond the last page to the last page", async () => {
    const onPageChange = vi.fn();
    intl(<DataTablePagination {...base} page={99} onPageChange={onPageChange} />);

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(3));
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("51–60 of 60")).toBeInTheDocument();
  });

  it("does not clamp while rows are loading (the total is not final)", () => {
    const onPageChange = vi.fn();
    intl(<DataTablePagination {...base} total={0} page={4} clamp={false} onPageChange={onPageChange} />);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("shows 0–0 for an empty set and changes the page size", async () => {
    const onPageSizeChange = vi.fn();
    intl(<DataTablePagination {...base} total={0} page={1} onPageSizeChange={onPageSizeChange} />);
    expect(screen.getByText("0–0 of 0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(await screen.findByRole("option", { name: "50 per page" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe("DataTableViewOptions", () => {
  const columns: ViewColumn[] = [
    { id: "select", label: "Selection", hideable: false },
    { id: "code", label: "Code", hideable: true },
    { id: "name", label: "Name", hideable: true },
  ];
  const config: ColumnConfig[] = [
    { id: "select", visible: true },
    { id: "code", visible: true, width: 200 },
    { id: "name", visible: false },
  ];
  const defaults: ColumnConfig[] = columns.map(({ id }) => ({ id, visible: true }));

  async function open(onChange = vi.fn()) {
    intl(<DataTableViewOptions columns={columns} config={config} defaults={defaults} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    return onChange;
  }

  it("toggles visibility, locks non-hideable columns, moves and resets", async () => {
    const onChange = await open();

    expect(screen.getByRole("checkbox", { name: "Selection" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Name" }));
    expect(onChange).toHaveBeenLastCalledWith(config.map((c) => (c.id === "name" ? { ...c, visible: true } : c)));

    await userEvent.click(screen.getByRole("button", { name: "Move Name up" }));
    expect(onChange.mock.lastCall?.[0].map((c: ColumnConfig) => c.id)).toEqual(["select", "name", "code"]);
    expect(screen.getByRole("button", { name: "Move Selection up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Name down" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(onChange).toHaveBeenLastCalledWith(defaults);
  });

  it("keeps the width as a local draft and commits on blur", async () => {
    const onChange = await open();
    const input = screen.getByRole("spinbutton", { name: "Width of Code" });
    expect(input).toHaveValue(200);

    await userEvent.clear(input);
    await userEvent.type(input, "320");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall?.[0].find((c: ColumnConfig) => c.id === "code")?.width).toBe(320);
  });

  it("commits on Enter and clamps to the 80–1200 range", async () => {
    const onChange = await open();
    const input = screen.getByRole("spinbutton", { name: "Width of Code" });

    await userEvent.clear(input);
    await userEvent.type(input, "5000{Enter}");
    expect(onChange.mock.lastCall?.[0].find((c: ColumnConfig) => c.id === "code")?.width).toBe(1200);
    expect(input).toHaveValue(1200);

    await userEvent.clear(input);
    await userEvent.type(input, "10{Enter}");
    expect(onChange.mock.lastCall?.[0].find((c: ColumnConfig) => c.id === "code")?.width).toBe(80);
  });

  it("reverts an empty draft and does not report an unchanged width", async () => {
    const onChange = await open();
    const input = screen.getByRole("spinbutton", { name: "Width of Code" });

    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(input).toHaveValue(200);

    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DataTableToolbar", () => {
  const facets: FacetConfig[] = [
    { id: "status", label: "Status", kind: "options", options: [{ value: "ACTIVE", label: "Active" }] },
  ];
  const props = {
    facets,
    showArchivedToggle: true,
    viewColumns: [{ id: "code", label: "Code", hideable: true }],
    columnConfig: [{ id: "code", visible: true }],
    defaultColumnConfig: [{ id: "code", visible: true }],
    onColumnConfigChange: vi.fn(),
  };
  const query = (input: ListQueryInput = {}) => listQuerySchema.parse(input);

  it("normalizes stored filters into lists", () => {
    expect(facetValuesOf({ a: "x", b: ["y", "z"] })).toEqual({ a: ["x"], b: ["y", "z"] });
  });

  it("shows Clear only with an active filter, search or archived flag, and resets all of them", async () => {
    const quiet = intl(<DataTableToolbar {...props} query={query()} onQueryChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    quiet.unmount();

    const onQueryChange = vi.fn();
    intl(<DataTableToolbar {...props} query={query({ filters: { status: ["ACTIVE"] } })} onQueryChange={onQueryChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onQueryChange).toHaveBeenCalledWith({ filters: {}, q: undefined, includeArchived: false });
  });

  it("toggles archived through a label bound by a generated id, unique per toolbar", async () => {
    const onQueryChange = vi.fn();
    intl(
      <>
        <DataTableToolbar {...props} query={query()} onQueryChange={onQueryChange} />
        <DataTableToolbar {...props} query={query()} onQueryChange={vi.fn()} />
      </>,
    );
    const switches = screen.getAllByRole("switch", { name: "Show archived" });
    expect(switches).toHaveLength(2);
    expect(switches[0]?.id).not.toBe(switches[1]?.id);
    expect(switches[0]?.id).not.toBe("table-show-archived");

    await userEvent.click(switches[0] as HTMLElement);
    expect(onQueryChange).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("writes and removes a facet value in the filters", async () => {
    const onQueryChange = vi.fn();
    intl(<DataTableToolbar {...props} query={query()} onQueryChange={onQueryChange} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Active" }));
    expect(onQueryChange).toHaveBeenLastCalledWith({ filters: { status: ["ACTIVE"] } });
  });

  it("removes a facet through its chip and shows export only when handled", async () => {
    const onQueryChange = vi.fn();
    const onExport = vi.fn();
    intl(
      <DataTableToolbar
        {...props}
        showArchivedToggle={false}
        query={query({ filters: { status: ["ACTIVE"] } })}
        onQueryChange={onQueryChange}
        onExport={onExport}
      />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Status filter" }));
    expect(onQueryChange).toHaveBeenCalledWith({ filters: {} });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalled();
  });
});
