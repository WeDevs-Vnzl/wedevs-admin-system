import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
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

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// A fixed value prop would reset what the user types (the component is controlled), so typing
// tests keep the value in state, as a form does.
function Controlled({
  initial = "",
  onChange,
  onBlur,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneInput
        value={value}
        onBlur={onBlur}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button" onClick={() => setValue("+12125550123")}>
        external
      </button>
    </>
  );
}

describe("PhoneInput coverage", () => {
  it("emits an empty string for a value of only punctuation (no digits to dial)", async () => {
    const onChange = vi.fn();
    renderIntl(<PhoneInput value="" onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox", { name: "Número de teléfono" }), " -()");

    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("keeps the typed digits and the country when the input is not a parseable number", async () => {
    const onChange = vi.fn();
    renderIntl(<Controlled onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox", { name: "Número de teléfono" }), "9");

    // Venezuela is the default country; with no valid national number the E.164 is prefix + digits.
    expect(onChange).toHaveBeenLastCalledWith("+589");
  });

  it("falls back to the given default country for a value without a recognizable country", () => {
    renderIntl(<PhoneInput value="" defaultCountry="ES" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("+34");
  });

  it("reads a stored value with no leading plus as a national number in the fallback country", () => {
    renderIntl(<PhoneInput value="4121234567" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("+58");
    expect(screen.getByRole("textbox", { name: "Número de teléfono" })).toHaveValue("4121234567");
  });

  it("uses the caller's aria-label, and the id-based field keeps no default label", () => {
    const { unmount } = renderIntl(<PhoneInput value="" onChange={() => {}} aria-label="Teléfono principal" />);
    expect(screen.getByRole("textbox", { name: "Teléfono principal" })).toBeInTheDocument();
    unmount();

    renderIntl(<PhoneInput id="phone" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("textbox")).toHaveAttribute("id", "phone");
  });

  it("forwards name, the ref and aria-invalid to the number input", () => {
    const ref = { current: null as HTMLInputElement | null };
    renderIntl(
      <PhoneInput
        ref={(node) => {
          ref.current = node;
        }}
        name="phone"
        value=""
        onChange={() => {}}
        aria-invalid
      />,
    );

    const input = screen.getByRole("textbox", { name: "Número de teléfono" });
    expect(input).toHaveAttribute("name", "phone");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(ref.current).toBe(input);
  });

  it("disables both the prefix picker and the number input", () => {
    renderIntl(<PhoneInput value="" disabled onChange={() => {}} />);

    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Número de teléfono" })).toBeDisabled();
  });

  it("normalises a valid national number to its formatted form on blur and reports the blur", async () => {
    const onBlur = vi.fn();
    const onChange = vi.fn();
    renderIntl(<Controlled onBlur={onBlur} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Número de teléfono" });

    await userEvent.type(input, "4121234567");
    await userEvent.tab();

    expect(input).toHaveValue("0412-1234567");
    expect(onChange).toHaveBeenLastCalledWith("+584121234567");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("leaves an invalid number as typed on blur, still reporting the blur", async () => {
    const onBlur = vi.fn();
    renderIntl(<Controlled onBlur={onBlur} />);
    const input = screen.getByRole("textbox", { name: "Número de teléfono" });

    await userEvent.type(input, "12");
    await userEvent.tab();

    expect(input).toHaveValue("12");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("follows a value changed from outside the component and picks up its country", () => {
    renderIntl(<Controlled initial="+584121234567" />);
    expect(screen.getByRole("textbox")).toHaveValue("0412-1234567");

    fireEvent.click(screen.getByRole("button", { name: "external" }));

    expect(screen.getByRole("textbox")).toHaveValue("(212) 555-0123");
    expect(screen.getByRole("combobox")).toHaveTextContent("+1");
  });

  it("does not emit onChange for a value set from outside the component", () => {
    const onChange = vi.fn();
    renderIntl(<Controlled initial="+584121234567" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "external" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
