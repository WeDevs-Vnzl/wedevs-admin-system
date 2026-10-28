import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enInvoices from "@/i18n/messages/en/invoices.json";
import esInvoices from "@/i18n/messages/es/invoices.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { computeInvoiceTotals } from "@/lib/finance";
import { InvoiceTotalsPanel } from "./invoice-totals-panel";

// The S2 tester case: lines at 16 %, 8 %, 0 % and exempt, a line discount, and a +0.01 adjustment on 8 %.
const totals = computeInvoiceTotals({
  lines: [
    { quantity: "1", unitPrice: "1000.00", discount: "100.00", ivaRate: "16" },
    { quantity: "2", unitPrice: "250.00", discount: "0.00", ivaRate: "8" },
    { quantity: "1", unitPrice: "200.00", discount: "0.00", ivaRate: "0" },
    { quantity: "1", unitPrice: "300.00", discount: "0.00", ivaRate: null },
  ],
  taxAdjustments: [{ ivaRate: "8", adjustment: "0.01" }],
  ivaWithheld: "0.00",
  islrWithheld: "0.00",
  otherWithheld: "0.00",
  usdRate: "1",
});

function renderPanel(locale: "es" | "en" = "es") {
  const invoices = locale === "es" ? esInvoices : enInvoices;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ invoices, patterns: esPatterns }}>
      <InvoiceTotalsPanel totals={totals} currency="USD" />
    </NextIntlClientProvider>,
  );
}

describe("InvoiceTotalsPanel", () => {
  it("shows one row per VAT rate of the taxable lines (DT-44)", () => {
    renderPanel();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // Header plus the three taxable rates; the exempt line has no rate row.
    expect(rows).toHaveLength(4);
    expect(screen.getByText("IVA 16 %")).toBeInTheDocument();
    expect(screen.getByText("IVA 8 %")).toBeInTheDocument();
    expect(screen.getByText("IVA 0 %")).toBeInTheDocument();
  });

  it("labels the header totals from the catalog, without re-deriving them", () => {
    renderPanel();
    expect(screen.getByText("Base imponible")).toBeInTheDocument();
    expect(screen.getByText("Exento")).toBeInTheDocument();
    expect(screen.getByText("Por cobrar en USD")).toBeInTheDocument();
  });

  it("the per-rate IVA values are the C17 ones, the 8 % rate carrying its +0.01 adjustment", () => {
    expect(totals.taxLines.map((line) => [line.ivaRate, line.ivaAmount])).toEqual([
      ["16", "144.00"],
      ["8", "40.01"],
      ["0", "0.00"],
    ]);
    expect(totals.total).toBe("2084.01");
  });

  it("renders in English when the locale is en", () => {
    renderPanel("en");
    expect(screen.getByText("Taxable base")).toBeInTheDocument();
    expect(screen.getByText("VAT 16 %")).toBeInTheDocument();
  });
});
