import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCatalogs from "@/i18n/messages/en/catalogs.json";
import enEnums from "@/i18n/messages/en/enums.json";
import type { TechnologyChipDTO, TechnologyListRowDTO } from "@/lib/validators/technologies";
import { TechnologyPicker } from "./technology-picker";

const rows: TechnologyListRowDTO[] = [
  {
    id: "tec_next_js",
    name: "Next.js",
    nameEn: null,
    slug: "next-js",
    category: "FRONTEND",
    iconSlug: "nextdotjs",
    color: null,
    active: true,
    usageCount: 2,
  },
  {
    id: "tec_react",
    name: "React",
    nameEn: "React JS",
    slug: "react",
    category: "FRONTEND",
    iconSlug: "react",
    color: "#61dafb",
    active: true,
    usageCount: 1,
  },
  {
    id: "tec_rust",
    name: "Rust",
    nameEn: null,
    slug: "rust",
    category: "LENGUAJE",
    iconSlug: null,
    color: null,
    active: false,
    usageCount: 0,
  },
  {
    id: "tec_go",
    name: "Go",
    nameEn: null,
    slug: "go",
    category: "LENGUAJE",
    iconSlug: null,
    color: null,
    active: true,
    usageCount: 0,
  },
];

function renderPicker(
  value: string[] = [],
  onChange = vi.fn(),
  locale: "en" | "es" = "en",
  selected: readonly TechnologyChipDTO[] = [],
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ catalogs: enCatalogs, enums: enEnums }}>
      <TechnologyPicker value={value} onChange={onChange} technologies={rows} selected={selected} />
    </NextIntlClientProvider>,
  );
}

// Rust is inactive: it sits on the record's stack but is not in the active catalog.
const rustChip: TechnologyChipDTO = {
  id: "tec_rust",
  name: "Rust",
  nameEn: null,
  slug: "rust",
  category: "LENGUAJE",
  iconSlug: null,
  color: null,
};

beforeAll(() => {
  // cmdk scrolls the highlighted item into view; jsdom does not implement it.
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("TechnologyPicker", () => {
  it("offers only active technologies, grouped by category (HU-06 CA1)", async () => {
    renderPicker();
    await userEvent.click(screen.getByRole("combobox"));
    const list = await screen.findByRole("listbox");

    const frontend = within(list).getByRole("group", { name: "Frontend" });
    expect(within(frontend).getByText("Next.js")).toBeInTheDocument();
    expect(within(frontend).getByText("React JS")).toBeInTheDocument();

    const languages = within(list).getByRole("group", { name: "Language" });
    expect(within(languages).getByText("Go")).toBeInTheDocument();
    expect(within(list).queryByText("Rust")).toBeNull();
  });

  it("toggles a technology on selection and reports the new ids", async () => {
    const onChange = vi.fn();
    renderPicker([], onChange);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /Go/ }));
    expect(onChange).toHaveBeenCalledWith(["tec_go"]);
  });

  it("shows the Spanish name in Spanish and the English one in English", async () => {
    renderPicker(["tec_react"], vi.fn(), "en");
    expect(screen.getByRole("combobox")).toHaveTextContent("React JS");
  });

  it("shows an inactive selected technology as a removable chip marked inactive", async () => {
    const onChange = vi.fn();
    renderPicker(["tec_rust", "tec_go"], onChange, "en", [rustChip]);
    const chip = screen.getByRole("button", { name: /Rust.*Inactive/ });
    await userEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(["tec_go"]);
  });

  it("never offers an inactive technology for a new selection", async () => {
    renderPicker(["tec_go"], vi.fn(), "en", [rustChip]);
    await userEvent.click(screen.getByRole("combobox"));
    const list = await screen.findByRole("listbox");
    expect(within(list).queryByText("Rust")).toBeNull();
  });

  it("exposes the selected state of each option to assistive technology", async () => {
    renderPicker(["tec_go"]);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /Go/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("option", { name: /React JS/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
