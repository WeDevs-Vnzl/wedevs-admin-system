import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { MoneyInput, type MoneyInputValue } from "./money-input";

const CURRENCIES = [{ code: "USD" }, { code: "VES" }];

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function Harness({
  initial,
  usdRate,
  onChange,
}: {
  initial: MoneyInputValue;
  usdRate?: string | null;
  onChange?: (value: MoneyInputValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MoneyInput
      value={value}
      currencies={CURRENCIES}
      usdRate={usdRate}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("MoneyInput", () => {
  it("normalizes ES typing ('1.234,56') to the canonical string '1234.56'", async () => {
    const onChange = vi.fn();
    renderIntl(<Harness initial={{ amount: "", currency: "VES" }} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Importe" });

    await userEvent.type(input, "1.234,56");

    expect(input).toHaveValue("1.234,56");
    expect(onChange).toHaveBeenLastCalledWith({ amount: "1234.56", currency: "VES" });
    for (const [value] of onChange.mock.calls) expect(typeof value.amount).toBe("string");
  });

  it("normalizes EN typing and reformats on blur", async () => {
    const onChange = vi.fn();
    renderIntl(<Harness initial={{ amount: "", currency: "USD" }} onChange={onChange} />, "en");
    const input = screen.getByRole("textbox", { name: "Amount" });

    await userEvent.type(input, "1,234.5");
    expect(onChange).toHaveBeenLastCalledWith({ amount: "1234.5", currency: "USD" });

    await userEvent.tab();
    expect(input).toHaveValue("1,234.50");
  });

  it("shows the live USD equivalent computed from the rate string (VES at 755.16)", () => {
    renderIntl(<Harness initial={{ amount: "1234.56", currency: "VES" }} usdRate="755.16" />);
    // 1234.56 / 755.16 = 1.6348… → 1.63, formatted by Intl in the ES locale.
    expect(screen.getByText(/^≈ .*1,63/)).toBeInTheDocument();
  });

  it("updates the equivalent while typing", async () => {
    renderIntl(<Harness initial={{ amount: "", currency: "VES" }} usdRate="755.16" />, "en");
    await userEvent.type(screen.getByRole("textbox", { name: "Amount" }), "755.16");
    expect(screen.getByText("≈ $1.00")).toBeInTheDocument();
  });

  it("hides the equivalent for USD and when there is no rate", () => {
    const { unmount } = renderIntl(
      <Harness initial={{ amount: "755.16", currency: "USD" }} usdRate="755.16" />,
      "en",
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    unmount();

    renderIntl(<Harness initial={{ amount: "755.16", currency: "VES" }} usdRate={null} />, "en");
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("flags unreadable text and emits an empty amount", async () => {
    const onChange = vi.fn();
    renderIntl(<Harness initial={{ amount: "", currency: "VES" }} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Importe" });

    await userEvent.type(input, "12a");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenLastCalledWith({ amount: "", currency: "VES" });
    expect(input).toHaveValue("12a");
  });

  it("works with react-hook-form Controller and keeps the amount a string", async () => {
    const submitted = vi.fn();
    function Form() {
      const { control, handleSubmit } = useForm<{ price: MoneyInputValue }>({
        defaultValues: { price: { amount: "", currency: "VES" } },
      });
      return (
        <form onSubmit={handleSubmit((data) => submitted(data))}>
          <Controller
            name="price"
            control={control}
            render={({ field }) => (
              <MoneyInput
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                currencies={CURRENCIES}
              />
            )}
          />
          <button type="submit">go</button>
        </form>
      );
    }
    renderIntl(<Form />);

    await userEvent.type(screen.getByRole("textbox", { name: "Importe" }), "1.234,56");
    await userEvent.click(screen.getByRole("button", { name: "go" }));

    expect(submitted).toHaveBeenCalledWith({ price: { amount: "1234.56", currency: "VES" } });
  });

  it("resets the text when the form value changes from outside", () => {
    const { rerender } = renderIntl(
      <MoneyInput value={{ amount: "10", currency: "USD" }} onChange={() => {}} currencies={CURRENCIES} />,
    );
    expect(screen.getByRole("textbox", { name: "Importe" })).toHaveValue("10,00");

    rerender(
      <NextIntlClientProvider locale="es" messages={{ forms: esForms }}>
        <MoneyInput value={{ amount: "", currency: "USD" }} onChange={() => {}} currencies={CURRENCIES} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Importe" })).toHaveValue("");
  });
});
