import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { KpiCard } from "./kpi-card";
import { RelatedMiniTable } from "./related-mini-table";

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={{ patterns: esPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("KpiCard", () => {
  it("names its link by its content (label and value) plus the open hint, without an aria-label", () => {
    wrap(<KpiCard label="Ingresos" value="$1,200.00" href="/reports/revenue" />);

    const link = screen.getByRole("link", { name: /Ingresos/ });
    expect(link).not.toHaveAttribute("aria-label");
    expect(link).toHaveAccessibleName(`Ingresos $1,200.00 ${esPatterns.kpi.open}`);
  });

  it("draws the focus ring on the card when its link has keyboard focus", () => {
    wrap(<KpiCard label="Ingresos" value="$1,200.00" href="/reports/revenue" />);

    const card = screen.getByRole("link").closest("[data-slot=card]");
    expect(card?.className).toContain("has-[a:focus-visible]:ring-[3px]");
    expect(card?.className).toContain("has-[a:focus-visible]:ring-ring/50");
  });

  it("renders a plain card without a link when there is no href", () => {
    wrap(<KpiCard label="Ingresos" value="$1,200.00" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("RelatedMiniTable", () => {
  it("takes the 'Nuevo' text from the message, not from code", () => {
    wrap(
      <RelatedMiniTable title="Proyectos" headers={["Nombre"]} rows={[]} newHref="/projects/new" />,
    );
    expect(screen.getByRole("link", { name: esPatterns.relatedTable.new })).toHaveTextContent(
      /^Nuevo$/,
    );
  });
});
