import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { DateText } from "./date-text";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DateText", () => {
  it("renders a date-only string as its calendar day in the ES locale", () => {
    wrap(<DateText value="2026-03-15" />);

    const time = screen.getByText("15 mar 2026");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-03-15");
  });

  it("renders the same calendar day in the EN locale", () => {
    wrap(<DateText value="2026-03-15" />, "en");
    expect(screen.getByText("Mar 15, 2026")).toHaveAttribute("datetime", "2026-03-15");
  });

  it("shows an instant in the display zone, defaulting to the business zone (Caracas)", () => {
    // 02:00 UTC on the 15th is still the 14th in Caracas (UTC-4).
    const instant = new Date("2026-03-15T02:00:00Z");
    const { unmount } = wrap(<DateText value={instant} />);
    expect(screen.getByText("14 mar 2026")).toHaveAttribute("datetime", instant.toISOString());
    unmount();

    wrap(<DateText value={instant} timeZone="UTC" />);
    expect(screen.getByText("15 mar 2026")).toBeInTheDocument();
  });

  it("keeps the nowrap class and merges a custom className", () => {
    wrap(<DateText value="2026-03-15" style="long" className="text-sm" />);

    const time = screen.getByText("15 de marzo de 2026");
    expect(time).toHaveClass("whitespace-nowrap", "text-sm");
  });
});
