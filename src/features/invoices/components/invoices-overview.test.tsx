import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import esInvoices from "@/i18n/messages/es/invoices.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esTable from "@/i18n/messages/es/table.json";
import type { InvoicesOverviewDTO } from "@/lib/validators/invoices";

const messages = { invoices: esInvoices, patterns: esPatterns, table: esTable };

vi.mock("next-intl/server", () => ({
  getLocale: async () => "es",
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "es", messages, namespace: namespace as "invoices" }),
}));
vi.mock("@/features/alerts/components/alert-list", () => ({
  AlertList: ({ types }: { types: readonly string[] }) => (
    <div data-testid="alert-list">{types.join(",")}</div>
  ),
}));

import { InvoicesOverview } from "./invoices-overview";

const overview: InvoicesOverviewDTO = {
  billedVsCollected: {
    periods: ["2026-05", "2026-06"],
    series: [
      { id: "billed", values: ["1000.00", "2000.00"] },
      { id: "collected", values: ["500.00", "1500.00"] },
    ],
  },
  aging: { d0_30: "100.00", d31_60: "200.00", d61_90: "0.00", d90plus: "50.00" },
  overdueCount: 3,
  totalsByCurrency: [{ currency: "USD", total: "4000.00", balance: "1250.00", overdue: "350.00" }],
} as InvoicesOverviewDTO;

async function renderOverview(canCreate = true) {
  const element = await InvoicesOverview({ overview, canCreate });
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe("InvoicesOverview", () => {
  it("shows the overdue count and the receivable per currency as KPIs", async () => {
    await renderOverview();
    expect(screen.getByText("Vencidas")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Por cobrar en USD")).toBeInTheDocument();
  });

  it("lists billed against collected and the aging as simple lists, without tables", async () => {
    await renderOverview();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const lists = screen.getAllByRole("list");
    const [trend, aging] = lists as [HTMLElement, HTMLElement];
    expect(within(trend).getAllByRole("listitem")).toHaveLength(2);
    expect(within(trend).getAllByText("Facturado").length).toBeGreaterThan(0);
    expect(within(aging).getByText("Más de 90 días")).toBeInTheDocument();
    expect(within(aging).getAllByRole("listitem")).toHaveLength(4);
  });

  it("offers the overview/table toggle, the create action only when allowed, and the invoice alerts", async () => {
    const { unmount } = await renderOverview(true);
    expect(screen.getByText(esPatterns.overviewToggle.table).closest("a")).toHaveAttribute(
      "href",
      "/invoices/list",
    );
    expect(screen.getByRole("link", { name: "Nueva factura" })).toHaveAttribute(
      "href",
      "/invoices/new",
    );
    expect(screen.getByTestId("alert-list")).toHaveTextContent("INVOICE_OVERDUE");
    unmount();

    await renderOverview(false);
    expect(screen.queryByRole("link", { name: "Nueva factura" })).not.toBeInTheDocument();
  });
});
