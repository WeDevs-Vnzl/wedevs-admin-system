import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { OverviewTableToggle } from "./overview-table-toggle";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const hrefs = { overviewHref: "/clients", tableHref: "/clients/list" };

describe("OverviewTableToggle", () => {
  it("names the segmented control with the ES label and shows both views", () => {
    wrap(<OverviewTableToggle current="overview" {...hrefs} />);

    expect(screen.getByRole("radiogroup", { name: "Vista" })).toBeInTheDocument();
    expect(screen.getByText("Resumen")).toBeInTheDocument();
    expect(screen.getByText("Tabla")).toBeInTheDocument();
  });

  it("marks the overview as the current page and links the table view", () => {
    wrap(<OverviewTableToggle current="overview" {...hrefs} />);

    expect(screen.getByText("Resumen").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Tabla").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Tabla").closest("a")).toHaveAttribute("href", "/clients/list");
  });

  it("marks the table as the current page when on /list", () => {
    wrap(<OverviewTableToggle current="table" {...hrefs} />);

    expect(screen.getByText("Tabla").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Resumen").closest("a")).toHaveAttribute("href", "/clients");
  });

  it("uses the EN labels under en", () => {
    wrap(<OverviewTableToggle current="table" {...hrefs} />, "en");

    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Table")).toBeInTheDocument();
  });
});
