import { render, screen } from "@testing-library/react";
import { Plus, Users } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

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

describe("EmptyState", () => {
  it("shows the title and description the caller passes", () => {
    wrap(<EmptyState title="Sin clientes" description="Crea el primero para empezar." />);

    expect(screen.getByText("Sin clientes")).toBeInTheDocument();
    expect(screen.getByText("Crea el primero para empezar.")).toBeInTheDocument();
  });

  it("hides the icon from assistive tech and renders it inside the media slot", () => {
    const { container } = wrap(<EmptyState icon={Users} title="Sin clientes" />);

    expect(container.querySelector("[data-slot=empty-icon] svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("omits the description and the content wrapper when they are not given", () => {
    const { container } = wrap(<EmptyState title="Vacío" />);

    expect(container.querySelector("[data-slot=empty-description]")).toBeNull();
    expect(container.querySelector("[data-slot=empty-content]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the CTA as the action, reachable by its accessible name", () => {
    wrap(<EmptyState icon={Plus} title="Sin clientes" action={<Button>Nuevo cliente</Button>} />);

    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeInTheDocument();
  });

  it("uses the title text in the EN locale without translating it itself", () => {
    wrap(<EmptyState title="No clients" description="Create the first one." />, "en");
    expect(screen.getByText("No clients")).toBeInTheDocument();
    expect(screen.getByText("Create the first one.")).toBeInTheDocument();
  });

  it("drops its border inside a card (embedded) and keeps it on its own", () => {
    const { container, rerender } = wrap(<EmptyState title="Sin notas" />);
    expect(container.querySelector("[data-slot=empty]")).toHaveClass("border");

    rerender(
      <NextIntlClientProvider locale="es" messages={{ patterns: esPatterns }}>
        <EmptyState embedded title="Sin notas" />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("[data-slot=empty]")).toHaveClass("border-0");
    expect(screen.getByText("Sin notas")).toBeInTheDocument();
  });
});
