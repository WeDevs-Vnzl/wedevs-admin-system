import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListCode, SimpleListCard } from "./simple-list-card";

describe("SimpleListCard", () => {
  it("lists each row with its label and right-aligned value, without a table", () => {
    render(
      <SimpleListCard
        title="Por método"
        emptyTitle="Sin cobros"
        rows={[
          { id: "a", label: "Zelle", values: [{ node: "900,00 US$" }] },
          { id: "b", label: "Binance", values: [{ node: "100,00 US$" }] },
        ]}
      />,
    );

    expect(screen.getByText("Por método")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Zelle")).toBeInTheDocument();
    expect(within(items[0]!).getByText("900,00 US$").parentElement).toHaveClass("tabular-nums");
  });

  it("shows the empty text when there are no rows", () => {
    render(<SimpleListCard title="Por cuenta" emptyTitle="Sin cobros" rows={[]} />);
    expect(screen.getByText("Sin cobros")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("names each value with its label when a row carries several", () => {
    render(
      <SimpleListCard
        title="Facturado vs. cobrado"
        emptyTitle="Sin datos"
        rows={[
          {
            id: "2026-10",
            label: "Octubre",
            values: [
              { label: "Facturado", node: "500" },
              { label: "Cobrado", node: "300" },
            ],
          },
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Facturado")).toHaveClass("text-muted-foreground");
    expect(within(item).getByText("Cobrado")).toBeInTheDocument();
    expect(within(item).getByText("300")).toBeInTheDocument();
  });

  it("links a record code and name to its detail", () => {
    render(<ListCode href="/payments/p1" code="PAG-0003" name="Kairos Studio" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/payments/p1");
    expect(within(link).getByText("PAG-0003")).toHaveClass("font-mono");
  });
});
