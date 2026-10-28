import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import esForms from "@/i18n/messages/es/forms.json";
import { PhoneInput } from "./phone-input";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="es" messages={{ forms: esForms }}>
      <PhoneInput
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

describe("PhoneInput", () => {
  it("emits E.164 for a national number, dropping the trunk prefix (default country VE)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox", { name: "Número de teléfono" }), "0412 123 4567");

    expect(onChange).toHaveBeenLastCalledWith("+584121234567");
    expect(screen.getByRole("combobox")).toHaveTextContent("+58");
  });

  it("reads an international number pasted into the field and switches the country", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Número de teléfono" });

    await userEvent.click(input);
    await userEvent.paste("+1 212 555 0123");

    expect(onChange).toHaveBeenLastCalledWith("+12125550123");
    expect(screen.getByRole("combobox")).toHaveTextContent("+1");
  });

  it("shows an existing E.164 value as a national number", () => {
    render(<Harness initial="+584121234567" />);
    expect(screen.getByRole("textbox", { name: "Número de teléfono" })).toHaveValue("0412-1234567");
    expect(screen.getByRole("combobox")).toHaveTextContent("+58");
  });

  it("changes the prefix through the country picker and keeps the typed digits", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Número de teléfono" }), "6 12 34 56 78");

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByPlaceholderText("Buscar país…"), "espa");
    await userEvent.click(await screen.findByRole("option", { name: /España/ }));

    expect(onChange).toHaveBeenLastCalledWith("+34612345678");
  });

  it("emits an empty string when cleared", async () => {
    const onChange = vi.fn();
    render(<Harness initial="+584121234567" onChange={onChange} />);

    await userEvent.clear(screen.getByRole("textbox", { name: "Número de teléfono" }));

    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("describes the number input with the ids the field passes", () => {
    render(
      <NextIntlClientProvider locale="es" messages={{ forms: esForms }}>
        <p id="phone-hint">Código de país y número local.</p>
        <PhoneInput value="" onChange={() => undefined} aria-describedby="phone-hint" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Número de teléfono" })).toHaveAccessibleDescription(
      "Código de país y número local.",
    );
  });
});

