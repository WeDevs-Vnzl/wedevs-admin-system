import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { FormPage } from "./form-page";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

const props = {
  title: "Nuevo cliente",
  backHref: "/clients",
  footer: <button type="button">Guardar</button>,
};

describe("FormPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the title as the h1, a back link to the list and the optional description", () => {
    wrap(
      <FormPage {...props} description="Datos de contacto y fiscales.">
        <p>Campos</p>
      </FormPage>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Nuevo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/clients");
    expect(screen.getByText("Datos de contacto y fiscales.")).toBeInTheDocument();
  });

  it("renders the sections and the sticky footer actions", () => {
    wrap(
      <FormPage {...props}>
        <p>Sección uno</p>
        <p>Sección dos</p>
      </FormPage>,
    );

    expect(screen.getByText("Sección uno")).toBeInTheDocument();
    expect(screen.getByText("Sección dos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("keeps the header, sections and footer actions to one readable width", () => {
    const { container } = wrap(<FormPage {...props}><p>Campos</p></FormPage>);

    expect(container.querySelector("header")).toHaveClass("max-w-3xl");
    expect(screen.getByText("Campos").parentElement).toHaveClass("max-w-3xl");
    expect(screen.getByRole("button", { name: "Guardar" }).parentElement).toHaveClass("max-w-3xl");
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = wrap(<FormPage {...props}><p>Campos</p></FormPage>);
    expect(container.querySelector("header p")).toBeNull();
  });

  it("does not guard the page while the form is clean", () => {
    wrap(<FormPage {...props}><p>Campos</p></FormPage>);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("asks the browser to confirm leaving the page while the form is dirty", () => {
    wrap(<FormPage {...props} dirty><p>Campos</p></FormPage>);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("asks with the ES message before an in-app link leaves a dirty form, and stays when declined", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    wrap(<FormPage {...props} dirty><p>Campos</p></FormPage>);

    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Volver" }));

    expect(confirm).toHaveBeenCalledWith(esPatterns.unsavedChanges.message);
    expect(notPrevented).toBe(false);
  });

  it("lets the link through when the user confirms leaving", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    wrap(<FormPage {...props} dirty><p>Campos</p></FormPage>, "en");

    // Record whether the guard prevented the click, then cancel the default so jsdom does not try
    // to navigate (jsdom does not implement navigation).
    const defaultPrevented: boolean[] = [];
    const record = (event: Event) => {
      defaultPrevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    fireEvent.click(screen.getByRole("link", { name: "Back" }));
    window.removeEventListener("click", record);

    expect(defaultPrevented).toEqual([false]);
  });
});
