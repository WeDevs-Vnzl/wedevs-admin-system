import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as the page's only h1", () => {
    render(<PageHeader title="Clientes" />);
    expect(screen.getByRole("heading", { level: 1, name: "Clientes" })).toBeInTheDocument();
  });

  it("shows the description when given and omits its paragraph otherwise", () => {
    const { container, unmount } = render(<PageHeader title="Clientes" description="Cartera activa" />);
    expect(screen.getByText("Cartera activa").tagName).toBe("P");
    unmount();

    render(<PageHeader title="Clientes" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("shows the count as a tabular badge, including zero", () => {
    const { unmount } = render(<PageHeader title="Clientes" count={0} />);
    expect(screen.getByText("0")).toHaveClass("tabular-nums");
    unmount();

    render(<PageHeader title="Clientes" count={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders no count badge when count is undefined", () => {
    const { container } = render(<PageHeader title="Clientes" />);
    expect(container.querySelector("[data-slot=badge]")).toBeNull();
  });

  it("right-aligns the actions group when actions are given", () => {
    render(<PageHeader title="Clientes" actions={<Button>Nuevo cliente</Button>} />);

    const action = screen.getByRole("button", { name: "Nuevo cliente" });
    expect(action.parentElement).toHaveClass("flex-wrap");
  });
});
