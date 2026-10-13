import { render, screen } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("shows the label and the figure with tabular numerals", () => {
    render(<StatCard label="Facturas emitidas" value="128" />);

    expect(screen.getByText("Facturas emitidas")).toBeInTheDocument();
    expect(screen.getByText("128")).toHaveClass("tabular-nums", "font-semibold");
  });

  it("accepts a node as the value", () => {
    render(<StatCard label="Saldo" value={<strong>USD 900</strong>} />);
    expect(screen.getByText("USD 900").tagName).toBe("STRONG");
  });

  it("shows the hint under the figure when given", () => {
    render(<StatCard label="Vencidas" value="3" hint="Últimos 30 días" />);
    expect(screen.getByText("Últimos 30 días")).toHaveClass("text-xs");
  });

  it("renders the icon decoratively, hidden from assistive tech", () => {
    const { container } = render(<StatCard label="Cobros" value="7" icon={Wallet} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders no icon or hint when they are not given", () => {
    const { container } = render(<StatCard label="Cobros" value="7" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});
