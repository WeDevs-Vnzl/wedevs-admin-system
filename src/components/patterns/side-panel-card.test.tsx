import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SidePanelCard } from "./side-panel-card";

describe("SidePanelCard", () => {
  it("shows the title and the key-data children", () => {
    render(
      <SidePanelCard title="Datos clave">
        <dl>
          <dt>Moneda</dt>
          <dd>USD</dd>
        </dl>
      </SidePanelCard>,
    );

    expect(screen.getByText("Datos clave")).toHaveClass("text-sm", "font-medium");
    expect(screen.getByText("Moneda")).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
  });

  it("renders with an empty body when the children are empty", () => {
    const { container } = render(<SidePanelCard title="Vacía">{null}</SidePanelCard>);
    expect(screen.getByText("Vacía")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=card-content]")).toBeEmptyDOMElement();
  });
});
