import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DetailHeader } from "./detail-header";

beforeAll(() => {
  // Radix dropdown and popper need these in jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const base = {
  backHref: "/clients",
  code: "CLI-0007",
  name: "Panadería Sol",
  mode: "detail" as const,
  detailHref: "/clients/7",
  graphHref: "/clients/7/graph",
};

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DetailHeader", () => {
  it("renders the name as the page heading with its record code chip", () => {
    wrap(<DetailHeader {...base} />);

    expect(screen.getByRole("heading", { level: 1, name: "Panadería Sol" })).toBeInTheDocument();
    expect(screen.getByText("CLI-0007")).toHaveClass("font-mono");
  });

  it("links back with the ES label and the EN label under en", () => {
    const { unmount } = wrap(<DetailHeader {...base} />);
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute("href", "/clients");
    unmount();

    wrap(<DetailHeader {...base} />, "en");
    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute("href", "/clients");
  });

  it("marks the active Detalle/Grafo view with aria-current and links both views", () => {
    const { unmount } = wrap(<DetailHeader {...base} mode="detail" />);
    expect(screen.getByText("Detalle").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Grafo").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Grafo").closest("a")).toHaveAttribute("href", "/clients/7/graph");
    unmount();

    wrap(<DetailHeader {...base} mode="graph" />);
    expect(screen.getByText("Grafo").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Detalle").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("names the view toggle group with the ES label", () => {
    wrap(<DetailHeader {...base} />);
    expect(screen.getByRole("radiogroup", { name: "Vista" })).toBeInTheDocument();
  });

  it("renders the optional icon, status, tags and meta slots", () => {
    wrap(
      <DetailHeader
        {...base}
        icon={<span>ICON</span>}
        status={<span>Activo</span>}
        tags={<span>VIP</span>}
        meta={<span>Caracas</span>}
      />,
    );

    expect(screen.getByText("ICON")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("Caracas")).toBeInTheDocument();
  });

  it("omits the More menu trigger when there are no more actions", () => {
    wrap(<DetailHeader {...base} actions={<button type="button">Editar</button>} />);

    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: esPatterns.detailHeader.more })).not.toBeInTheDocument();
  });

  it("opens the More menu from its icon button and lists the menu items", async () => {
    wrap(
      <DetailHeader
        {...base}
        moreActions={
          <>
            <DropdownMenuItem>Archivar</DropdownMenuItem>
            <DropdownMenuItem>Anular</DropdownMenuItem>
          </>
        }
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Más acciones" }));

    expect(await screen.findByRole("menuitem", { name: "Archivar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Anular" })).toBeInTheDocument();
  });
});
