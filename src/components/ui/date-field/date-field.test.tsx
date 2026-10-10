import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { DateField } from "./date-field";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => vi.useRealTimers());

function Harness({
  initial = "",
  timeZone,
  locale = "es",
  onChange,
  min,
}: {
  initial?: string;
  timeZone?: string;
  locale?: "es" | "en";
  onChange?: (value: string) => void;
  min?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      <DateField
        aria-label="Fecha"
        value={value}
        timeZone={timeZone}
        min={min}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

describe("DateField", () => {
  it("shows the placeholder and then the formatted date", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("button", { name: "Fecha" })).toHaveTextContent("Seleccionar fecha");
    unmount();

    render(<Harness initial="2026-03-05" />);
    expect(screen.getByRole("button", { name: "Fecha" })).toHaveTextContent("5 mar 2026");
  });

  it("emits YYYY-MM-DD for the picked day, regardless of the process time zone", async () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-03-05" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Fecha" }));
    await userEvent.click(await screen.findByRole("button", { name: /15 de marzo de 2026/i }));

    expect(onChange).toHaveBeenCalledWith("2026-03-15");
    expect(screen.getByRole("button", { name: "Fecha" })).toHaveTextContent("15 mar 2026");
  });

  it("does not offer days before min", async () => {
    render(<Harness initial="2026-03-05" min="2026-03-04" />);

    await userEvent.click(screen.getByRole("button", { name: "Fecha" }));

    const cells = await screen.findAllByRole("gridcell");
    const day = (date: string) => cells.find((cell) => cell.getAttribute("data-day") === date);
    expect(day("2026-03-03")).toHaveAttribute("data-disabled", "true");
    expect(day("2026-03-04")).not.toHaveAttribute("data-disabled");
  });

  it("marks today in Caracas by default and in the given zone otherwise", async () => {
    // 2026-03-15T02:00Z is still the 14th in Caracas (UTC-4) and already the 15th in Auckland.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-15T02:00:00Z") });
    const caracas = render(<Harness />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Fecha" }));
    expect((await screen.findAllByRole("gridcell")).find((cell) => cell.hasAttribute("data-today"))).toHaveAttribute(
      "data-day",
      "2026-03-14",
    );
    caracas.unmount();
    document.body.innerHTML = "";

    render(<Harness timeZone="Pacific/Auckland" />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Fecha" }));
    expect((await screen.findAllByRole("gridcell")).find((cell) => cell.hasAttribute("data-today"))).toHaveAttribute(
      "data-day",
      "2026-03-15",
    );
  });
});
