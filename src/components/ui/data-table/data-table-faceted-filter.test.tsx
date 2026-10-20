import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enTable from "@/i18n/messages/en/table.json";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import type { FacetConfig, FacetOption } from "./types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => vi.useRealTimers());

function renderFacet(facet: FacetConfig, value: string[] = [], onChange = vi.fn(), labels = new Map<string, string>()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ table: enTable }}>
      <DataTableFacetedFilter facet={facet} value={value} labels={labels} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return { onChange, labels };
}

const options: FacetConfig = {
  id: "status",
  label: "Status",
  kind: "options",
  options: [
    { value: "EMITIDA", label: "Issued" },
    { value: "PAGADA", label: "Paid" },
  ],
};

describe("DataTableFacetedFilter (options)", () => {
  it("labels the search input and matches the visible label, not the stored value", async () => {
    renderFacet(options);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));

    const input = await screen.findByRole("combobox", { name: "Search Status" });
    await userEvent.type(input, "paid");
    expect(screen.getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Issued" })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    expect(screen.getByText(enTable.facet.empty)).toBeInTheDocument();
  });

  it("toggles an option, caches its label and clears the facet from the footer", async () => {
    const onChange = vi.fn();
    const { labels } = renderFacet(options, ["EMITIDA"], onChange);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));

    await userEvent.click(await screen.findByRole("option", { name: "Paid" }));
    expect(onChange).toHaveBeenLastCalledWith(["EMITIDA", "PAGADA"]);
    await userEvent.click(screen.getByRole("option", { name: "Issued" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(labels.get("PAGADA")).toBe("Paid");

    await userEvent.click(screen.getByRole("button", { name: enTable.facet.clear }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("DataTableFacetedFilter (async)", () => {
  const clients = (search: string): FacetOption[] =>
    [{ value: "c1", label: "Kairos" }, { value: "c2", label: "Nimbus" }].filter((o) =>
      o.label.toLowerCase().includes(search.toLowerCase()),
    );

  it("debounces the search before calling loadOptions", async () => {
    const loadOptions = vi.fn(async (search: string) => clients(search));
    renderFacet({ id: "clientId", label: "Client", kind: "async", loadOptions });
    await userEvent.click(screen.getByRole("button", { name: "Client" }));
    expect(await screen.findByRole("option", { name: "Kairos" })).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const input = screen.getByRole("combobox", { name: "Search Client" });
    for (const text of ["n", "ni", "nim"]) fireEvent.change(input, { target: { value: text } });
    expect(screen.getByText(enTable.facet.loading)).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(loadOptions).toHaveBeenCalledTimes(2);
    expect(loadOptions).toHaveBeenLastCalledWith("nim");
    vi.useRealTimers();
    expect(await screen.findByRole("option", { name: "Nimbus" })).toBeInTheDocument();
  });

  it("selects an async option and remembers its label", async () => {
    const onChange = vi.fn();
    const { labels } = renderFacet(
      { id: "clientId", label: "Client", kind: "async", loadOptions: async (s) => clients(s) },
      [],
      onChange,
    );
    await userEvent.click(screen.getByRole("button", { name: "Client" }));
    await userEvent.click(await screen.findByRole("option", { name: "Nimbus" }));
    expect(onChange).toHaveBeenCalledWith(["c2"]);
    expect(labels.get("c2")).toBe("Nimbus");
  });

  it("shows an error with a retry when loadOptions rejects, and recovers", async () => {
    const loadOptions = vi
      .fn<(search: string) => Promise<FacetOption[]>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(clients(""));
    renderFacet({ id: "clientId", label: "Client", kind: "async", loadOptions });
    await userEvent.click(screen.getByRole("button", { name: "Client" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(enTable.facet.error);
    expect(screen.queryByText(enTable.facet.empty)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: enTable.facet.retry }));
    expect(await screen.findByRole("option", { name: "Kairos" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadOptions).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state for a search without results", async () => {
    renderFacet({ id: "clientId", label: "Client", kind: "async", loadOptions: async () => [] });
    await userEvent.click(screen.getByRole("button", { name: "Client" }));
    await waitFor(() => expect(screen.getByText(enTable.facet.empty)).toBeInTheDocument());
  });
});

describe("DataTableFacetedFilter (date range)", () => {
  const facet: FacetConfig = { id: "date", label: "Date", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" };

  it("emits [from, to] as YYYY-MM-DD and clears", async () => {
    const onChange = vi.fn();
    renderFacet(facet, ["2026-03-10", "2026-03-12"], onChange);
    await userEvent.click(screen.getByRole("button", { name: "Date" }));

    await userEvent.click(await screen.findByRole("button", { name: /March 20\D/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.stringMatching(/^2026-03-\d\d$/)]));

    await userEvent.click(screen.getByRole("button", { name: enTable.facet.clear }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
