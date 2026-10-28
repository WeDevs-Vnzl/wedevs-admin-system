import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { CountryCombobox } from "./country-combobox";
import { listCountries } from "./countries";

beforeAll(() => {
  // cmdk and Radix popper need these in jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("listCountries", () => {
  it("localizes names with Intl and carries flag and dial code", () => {
    const es = listCountries("es").find((country) => country.code === "ES");
    const en = listCountries("en").find((country) => country.code === "ES");
    expect(es).toMatchObject({ name: "España", dialCode: "34", flag: "🇪🇸" });
    expect(en?.name).toBe("Spain");
    expect(listCountries("es").find((country) => country.code === "VE")?.dialCode).toBe("58");
  });

  it("sorts by the localized name", () => {
    const names = listCountries("es").map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
  });
});

describe("CountryCombobox", () => {
  it("shows the selected country with its flag", () => {
    renderIntl(<CountryCombobox value="VE" onChange={() => {}} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("🇻🇪");
    expect(trigger).toHaveTextContent("Venezuela");
  });

  it("shows the placeholder without a value", () => {
    renderIntl(<CountryCombobox value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Seleccionar país");
  });

  it("filters by localized name and emits the alpha-2 code", async () => {
    const onChange = vi.fn();
    renderIntl(<CountryCombobox value="" onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByPlaceholderText("Buscar país…"), "espa");
    await userEvent.click(await screen.findByRole("option", { name: /España/ }));

    expect(onChange).toHaveBeenCalledWith("ES");
  });

  it("finds countries by dial code and in English", async () => {
    const onChange = vi.fn();
    renderIntl(<CountryCombobox value="" onChange={onChange} />, "en");

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByPlaceholderText("Search country…"), "spain");
    expect(await screen.findByRole("option", { name: /Spain/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Venezuela/ })).not.toBeInTheDocument();
  });

  it("shows the dial code variant", () => {
    renderIntl(<CountryCombobox value="VE" variant="dial" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "País del prefijo telefónico" })).toHaveTextContent("+58");
  });
});
