import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewLayout } from "./overview-layout";

describe("OverviewLayout", () => {
  it("places header, KPI row, main and aside in that order", () => {
    const { container } = render(
      <OverviewLayout
        header={<h1>Clientes</h1>}
        kpis={<span>KPI</span>}
        main={<p>Recientes</p>}
        aside={<p>Alertas</p>}
      />,
    );

    const order = Array.from(container.querySelectorAll("h1, span, p")).map((node) => node.textContent);
    expect(order).toEqual(["Clientes", "KPI", "Recientes", "Alertas"]);
  });

  it("renders the aside landmark only when an aside is given", () => {
    const { container, unmount } = render(<OverviewLayout header={<h1>Clientes</h1>} main={<p>Main</p>} />);
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.getByText("Main")).toBeInTheDocument();
    unmount();

    const withAside = render(<OverviewLayout header={<h1>Clientes</h1>} main={<p>Main</p>} aside={<p>Side</p>} />);
    expect(withAside.container.querySelector("aside")).toHaveTextContent("Side");
  });

  it("omits the KPI grid when there are no KPIs", () => {
    const { container } = render(<OverviewLayout header={<h1>Clientes</h1>} main={<p>Main</p>} />);
    expect(container.querySelector(".sm\\:grid-cols-2")).toBeNull();
  });

  it("renders the KPI row as a responsive grid", () => {
    const { container } = render(
      <OverviewLayout header={<h1>Clientes</h1>} kpis={<span>KPI</span>} main={<p>Main</p>} />,
    );
    expect(container.querySelector(".sm\\:grid-cols-2.xl\\:grid-cols-4")).toContainElement(screen.getByText("KPI"));
  });
});
