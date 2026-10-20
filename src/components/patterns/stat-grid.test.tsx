import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatGrid } from "./stat-grid";

describe("StatGrid", () => {
  it("renders each figure as a label and value pair, with its hint, and no card of its own", () => {
    const { container } = render(
      <StatGrid
        items={[
          { label: "Total facturado", value: "2084,01 US$" },
          { label: "Proyectos", value: 0, hint: "Proyectos no archivados del cliente" },
        ]}
      />,
    );

    const terms = screen.getAllByRole("term");
    expect(terms.map((term) => term.textContent)).toEqual(["Total facturado", "Proyectos"]);
    expect(screen.getByText("2084,01 US$").tagName).toBe("DD");
    expect(screen.getByText("Proyectos no archivados del cliente")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=card]")).toBeNull();
  });
});
