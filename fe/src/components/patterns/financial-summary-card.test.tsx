import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { FinancialSummaryCard } from "./financial-summary-card";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FinancialSummaryCard", () => {
  it("titles itself with the ES default when no title is passed", () => {
    wrap(<FinancialSummaryCard rows={[]} />);
    expect(screen.getByText("Estado financiero")).toBeInTheDocument();
  });

  it("uses the EN default title under en, and a caller title over the default", () => {
    const { unmount } = wrap(<FinancialSummaryCard rows={[]} />, "en");
    expect(screen.getByText("Financial summary")).toBeInTheDocument();
    unmount();

    wrap(<FinancialSummaryCard title="Cuenta corriente" rows={[]} />);
    expect(screen.getByText("Cuenta corriente")).toBeInTheDocument();
    expect(screen.queryByText("Estado financiero")).not.toBeInTheDocument();
  });

  it("lists each row as label and value, with the danger tone only where flagged", () => {
    wrap(
      <FinancialSummaryCard
        rows={[
          { label: "Facturado", value: "1,200.00" },
          { label: "Vencido", value: "300.00", danger: true },
        ]}
      />,
    );

    expect(screen.getByText("Facturado").nextSibling).not.toHaveClass("text-red-400");
    expect(screen.getByText("300.00")).toHaveClass("text-red-400", "tabular-nums");
  });

  it("emphasises the bottom line below a border when a total is given", () => {
    wrap(
      <FinancialSummaryCard
        rows={[{ label: "Facturado", value: "1,200.00" }]}
        total={{ label: "Saldo", value: "900.00" }}
      />,
    );

    const label = screen.getByText("Saldo");
    expect(label.parentElement).toHaveClass("border-t");
    expect(screen.getByText("900.00")).toHaveClass("text-lg", "font-semibold");
  });

  it("uses the danger tone on a flagged total", () => {
    wrap(<FinancialSummaryCard rows={[]} total={{ label: "Saldo", value: "-15.00", danger: true }} />);
    expect(screen.getByText("-15.00")).toHaveClass("text-red-400");
  });

  it("renders no separator when there is no total", () => {
    const { container } = wrap(<FinancialSummaryCard rows={[{ label: "Facturado", value: "1.00" }]} />);
    expect(container.querySelector(".border-t")).toBeNull();
  });
});
