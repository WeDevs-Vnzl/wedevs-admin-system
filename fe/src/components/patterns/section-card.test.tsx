import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { SectionCard } from "./section-card";

describe("SectionCard", () => {
  it("shows the title, its children, and the description when given", () => {
    render(
      <SectionCard title="Datos fiscales" description="RIF y domicilio">
        <p>Contenido</p>
      </SectionCard>,
    );

    expect(screen.getByText("Datos fiscales")).toBeInTheDocument();
    expect(screen.getByText("RIF y domicilio")).toBeInTheDocument();
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });

  it("omits the description when it is not given", () => {
    const { container } = render(
      <SectionCard title="Datos fiscales">
        <p>Contenido</p>
      </SectionCard>,
    );
    expect(container.querySelector("[data-slot=card-description]")).toBeNull();
  });

  it("places the header actions beside the title, and omits the group when there are none", () => {
    const { container, unmount } = render(
      <SectionCard title="Contactos" actions={<Button>Agregar</Button>}>
        <p>Lista</p>
      </SectionCard>,
    );
    expect(screen.getByRole("button", { name: "Agregar" })).toBeInTheDocument();
    unmount();

    render(
      <SectionCard title="Contactos">
        <p>Lista</p>
      </SectionCard>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("exposes a form section as a group named by its title when asked", () => {
    const { unmount } = render(
      <SectionCard title="Identidad" group>
        <p>Campos</p>
      </SectionCard>,
    );
    expect(screen.getByRole("group", { name: "Identidad" })).toHaveTextContent("Campos");
    unmount();

    render(<SectionCard title="Identidad">x</SectionCard>);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
