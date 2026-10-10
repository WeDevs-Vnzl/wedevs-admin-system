import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { MoneyText } from "./money-text";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MoneyText", () => {
  it("formats a decimal string with two places in the ES locale (decimal comma)", () => {
    wrap(<MoneyText amount="1234.5" currency="USD" />);
    expect(screen.getByText(/1234,50/)).toHaveClass("tabular-nums", "text-right", "whitespace-nowrap");
  });

  it("formats the same amount with the grouping and decimal point of the EN locale", () => {
    wrap(<MoneyText amount="1234.5" currency="USD" />, "en");
    expect(screen.getByText(/1,234\.50/)).toBeInTheDocument();
  });

  it("uses the danger tone for negative amounts", () => {
    wrap(<MoneyText amount="-20.5" currency="USD" />, "en");
    expect(screen.getByText(/20\.50/)).toHaveClass("text-destructive");
  });

  it("keeps zero and -0.00 out of the danger tone", () => {
    const { unmount } = wrap(<MoneyText amount="0" currency="USD" />, "en");
    expect(screen.getByText(/0\.00/)).not.toHaveClass("text-destructive");
    unmount();

    wrap(<MoneyText amount="-0.00" currency="USD" />, "en");
    expect(screen.getByText(/0\.00/)).not.toHaveClass("text-destructive");
  });

  it("appends a non-ISO currency code instead of using Intl's currency style", () => {
    wrap(<MoneyText amount="10" currency="USDT" />, "en");
    expect(screen.getByText("10.00 USDT")).toBeInTheDocument();
  });

  it("merges a custom className", () => {
    wrap(<MoneyText amount="5" currency="USD" className="text-lg" />, "en");
    expect(screen.getByText(/5\.00/)).toHaveClass("text-lg");
  });
});
