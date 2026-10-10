import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { AsyncCombobox } from "./async-combobox";
import type { AsyncComboboxOption } from "./types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

const CLIENTS: AsyncComboboxOption[] = [
  { value: "c1", label: "Kairos Studio", description: "CLI-0001" },
  { value: "c2", label: "Kairos Labs", description: "CLI-0002" },
  { value: "c3", label: "Nimbus", description: "CLI-0003" },
];

function loaderFor(options: AsyncComboboxOption[]) {
  return vi.fn(async (query: string) =>
    options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())),
  );
}

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function Single({
  loadOptions,
  onCreate,
  onChange,
  initial = null,
  secondary,
}: {
  loadOptions: (query: string) => Promise<readonly AsyncComboboxOption[]>;
  onCreate?: (query: string) => Promise<AsyncComboboxOption | null | undefined | void>;
  onChange?: (value: AsyncComboboxOption | null) => void;
  initial?: AsyncComboboxOption | null;
  secondary?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AsyncCombobox
      aria-label="Client"
      value={value}
      loadOptions={loadOptions}
      onCreate={onCreate}
      debounceMs={10}
      secondaryInput={secondary ? { label: "Version" } : undefined}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function Multi({
  loadOptions,
  onChange,
  secondary,
}: {
  loadOptions: (query: string) => Promise<readonly AsyncComboboxOption[]>;
  onChange?: (value: AsyncComboboxOption[]) => void;
  secondary?: boolean;
}) {
  const [value, setValue] = useState<AsyncComboboxOption[]>([]);
  return (
    <AsyncCombobox
      multiple
      aria-label="Technologies"
      value={value}
      loadOptions={loadOptions}
      debounceMs={10}
      secondaryInput={secondary ? { label: "Version" } : undefined}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("AsyncCombobox (single)", () => {
  it("loads the initial list on open and selects with the mouse", async () => {
    const loadOptions = loaderFor(CLIENTS);
    const onChange = vi.fn();
    renderIntl(<Single loadOptions={loadOptions} onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox", { name: "Client" }));

    expect(await screen.findByRole("option", { name: /Nimbus/ })).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledWith("");
    await userEvent.click(screen.getByRole("option", { name: /Nimbus/ }));

    expect(onChange).toHaveBeenLastCalledWith(CLIENTS[2]);
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveValue("Nimbus");
  });

  it("debounces typing into a single server query and shows the secondary line", async () => {
    const loadOptions = loaderFor(CLIENTS);
    renderIntl(<Single loadOptions={loadOptions} />);
    const input = screen.getByRole("combobox", { name: "Client" });

    await userEvent.click(input);
    await screen.findByRole("option", { name: /Nimbus/ });
    loadOptions.mockClear();
    await userEvent.type(input, "kair");

    await waitFor(() => expect(loadOptions).toHaveBeenCalledWith("kair"));
    expect(loadOptions).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("option", { name: /Kairos Labs/ })).toHaveTextContent("CLI-0002");
    await waitFor(() => expect(screen.queryByRole("option", { name: /Nimbus/ })).not.toBeInTheDocument());
  });

  it("navigates with the keyboard and selects with Enter", async () => {
    const onChange = vi.fn();
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Client" });

    await userEvent.click(input);
    await screen.findByRole("option", { name: /Kairos Studio/ });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenLastCalledWith(CLIENTS[1]);
  });

  it("offers 'Create' for a query without an exact match and selects the new option", async () => {
    const created: AsyncComboboxOption = { value: "c9", label: "Zeta" };
    const onCreate = vi.fn(async () => created);
    const onChange = vi.fn();
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} onCreate={onCreate} onChange={onChange} />);

    await userEvent.type(screen.getByRole("combobox", { name: "Client" }), "Zeta");
    await userEvent.click(await screen.findByRole("option", { name: 'Create "Zeta"' }));

    expect(onCreate).toHaveBeenCalledWith("Zeta");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(created));
  });

  it("does not offer 'Create' when the query matches an option exactly", async () => {
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} onCreate={vi.fn()} />);

    await userEvent.type(screen.getByRole("combobox", { name: "Client" }), "nimbus");

    await screen.findByRole("option", { name: /Nimbus/ });
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} />, "es");
    await userEvent.type(screen.getByRole("combobox", { name: "Client" }), "zzz");
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
  });

  it("clears the selection", async () => {
    const onChange = vi.fn();
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} onChange={onChange} initial={CLIENTS[0]!} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders grouped options under their headings", async () => {
    const grouped: AsyncComboboxOption[] = [
      { value: "a", label: "TypeScript", group: "Languages" },
      { value: "b", label: "PostgreSQL", group: "Databases" },
      { value: "c", label: "Go", group: "Languages" },
    ];
    renderIntl(<Single loadOptions={loaderFor(grouped)} />);

    await userEvent.click(screen.getByRole("combobox", { name: "Client" }));

    expect(await screen.findByText("Languages")).toBeInTheDocument();
    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("edits a per-item secondary value", async () => {
    const onChange = vi.fn();
    renderIntl(<Single loadOptions={loaderFor(CLIENTS)} onChange={onChange} initial={CLIENTS[0]!} secondary />);

    await userEvent.type(screen.getByRole("textbox", { name: "Version: Kairos Studio" }), "5");

    expect(onChange).toHaveBeenLastCalledWith({ ...CLIENTS[0], secondary: "5" });
  });
});

describe("AsyncCombobox (multiple)", () => {
  it("selects several options as chips and removes one", async () => {
    const onChange = vi.fn();
    renderIntl(<Multi loadOptions={loaderFor(CLIENTS)} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Technologies" });

    await userEvent.click(input);
    await userEvent.click(await screen.findByRole("option", { name: /Nimbus/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Kairos Labs/ }));

    expect(onChange).toHaveBeenLastCalledWith([CLIENTS[2], CLIENTS[1]]);
    expect(screen.getByRole("button", { name: "Remove Nimbus" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Nimbus" }));
    expect(onChange).toHaveBeenLastCalledWith([CLIENTS[1]]);
  });

  it("gives each selected item its own secondary input", async () => {
    const onChange = vi.fn();
    renderIntl(<Multi loadOptions={loaderFor(CLIENTS)} onChange={onChange} secondary />);

    await userEvent.click(screen.getByRole("combobox", { name: "Technologies" }));
    await userEvent.click(await screen.findByRole("option", { name: /Nimbus/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Kairos Labs/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Version: Kairos Labs" }), "2");

    expect(onChange).toHaveBeenLastCalledWith([CLIENTS[2], { ...CLIENTS[1], secondary: "2" }]);
  });
});
