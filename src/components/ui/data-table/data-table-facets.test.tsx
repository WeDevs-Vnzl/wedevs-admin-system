import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enTable from "@/i18n/messages/en/table.json";
import esTable from "@/i18n/messages/es/table.json";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableFilterChips, summarize } from "./data-table-filter-chips";
import type { FacetConfig } from "./types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const dateFacet: FacetConfig = { id: "createdAt", label: "Creado", kind: "dateRange" };
const optionsFacet: FacetConfig = {
  id: "status",
  label: "Estado",
  kind: "options",
  options: [{ value: "ACTIVE", label: "Activo" }],
};

function intl(locale: "es" | "en", ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale={locale} messages={{ table: locale === "es" ? esTable : enTable }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("DataTableFacetedFilter (date range)", () => {
  it("renders the calendar with Spanish month names in the es locale", async () => {
    render(
      intl(
        "es",
        <DataTableFacetedFilter
          facet={dateFacet}
          value={["2026-03-10", "2026-03-12"]}
          labels={new Map()}
          onChange={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /Creado/ }));

    expect(await screen.findByText(/marzo 2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/March/)).not.toBeInTheDocument();
  });

  it("renders English month names in the en locale", async () => {
    render(
      intl(
        "en",
        <DataTableFacetedFilter
          facet={dateFacet}
          value={["2026-03-10", "2026-03-12"]}
          labels={new Map()}
          onChange={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /Creado/ }));

    expect(await screen.findByText(/March 2026/)).toBeInTheDocument();
  });
});

describe("DataTableFilterChips", () => {
  it("shows a date range localized to the active locale through ICU messages (es)", () => {
    render(
      intl(
        "es",
        <DataTableFilterChips
          facets={[dateFacet]}
          values={{ createdAt: ["2026-03-10", "2026-03-12"] }}
          labels={new Map()}
          onChange={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("Creado:")).toBeInTheDocument();
    expect(screen.getByText("10 mar 2026 – 12 mar 2026")).toBeInTheDocument();
  });

  it("shows the same range in English format (en)", () => {
    render(
      intl(
        "en",
        <DataTableFilterChips
          facets={[dateFacet]}
          values={{ createdAt: ["2026-03-10", "2026-03-12"] }}
          labels={new Map()}
          onChange={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("Mar 10, 2026 – Mar 12, 2026")).toBeInTheDocument();
  });

  it("keeps option chips on the cached label and removes only its facet", async () => {
    const onChange = vi.fn();
    render(
      intl(
        "es",
        <DataTableFilterChips
          facets={[optionsFacet]}
          values={{ status: ["ACTIVE"] }}
          labels={new Map([["ACTIVE", "Activo"]])}
          onChange={onChange}
        />,
      ),
    );

    expect(screen.getByText("Activo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtro Estado" }));
    expect(onChange).toHaveBeenCalledWith("status", []);
  });

  it("falls back to the raw value when a URL date is malformed", () => {
    expect(summarize(dateFacet, ["nope", "2026-03-12"], new Map(), "es", (a, b) => `${a}|${b}`)).toBe(
      "nope|12 mar 2026",
    );
  });
});
