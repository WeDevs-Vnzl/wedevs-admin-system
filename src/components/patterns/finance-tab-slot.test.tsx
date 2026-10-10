import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { FinanceTabSlot, type FinanceTabKind } from "./finance-tab-slot";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FinanceTabSlot", () => {
  const kinds: FinanceTabKind[] = ["billing", "invoices", "payments", "expenses"];

  it.each(kinds)("renders the ES title and description of the %s tab", (kind) => {
    wrap(<FinanceTabSlot kind={kind} />);
    expect(screen.getByText(esPatterns.financeSlot[kind].title)).toBeInTheDocument();
    expect(screen.getByText(esPatterns.financeSlot[kind].description)).toBeInTheDocument();
  });

  it("renders the EN copy under the en locale", () => {
    wrap(<FinanceTabSlot kind="invoices" />, "en");
    expect(screen.getByText(enPatterns.financeSlot.invoices.title)).toBeInTheDocument();
    expect(screen.getByText(enPatterns.financeSlot.invoices.description)).toBeInTheDocument();
  });

  it("has a distinct title for each tab kind", () => {
    const titles = kinds.map((kind) => esPatterns.financeSlot[kind].title);
    expect(new Set(titles).size).toBe(kinds.length);
  });
});
